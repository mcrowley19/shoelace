import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  Animated,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import * as FileSystem from "expo-file-system";
import { AudioContext } from "react-native-audio-api";
import { fromByteArray } from "react-native-quick-base64";
import { useTasks } from "@/context/tasks-context";
import { useSettings } from "@/context/settings-context";
import { makeStyles, loadingStyles } from "@/styles/task";
import { v4 as uuidv4 } from "uuid";
import "react-native-get-random-values";
import { Audio } from "expo-av";
import { useCameraDevice, useCameraPermission } from "@/utils/vision-camera";
import { playDing } from "@/utils/audio";
import TaskCamera from "@/components/TaskCamera";
import CompletionOverlay from "@/components/CompletionOverlay";

const WS_URL = "wss://task-agent-746295074769.europe-west1.run.app/live";

const MAX_RECONNECT_ATTEMPTS = 8;
const RECONNECT_BASE_DELAY_MS = 1000;
const FRAME_DELAY_MS = 3000;

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getTask, toggleTask } = useTasks();
  const { soundEffects, transcriptions } = useSettings();
  const task = getTask(id);

  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<any>(null);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const device = useCameraDevice(facing);

  const wsRef = useRef<WebSocket | null>(null);
  const doneRef = useRef(false);

  const audioContextRef = useRef<AudioContext | null>(null);
  const queueNodeRef = useRef<any>(null);
  const pendingAudioBytesRef = useRef(0);
  const audioPlaybackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const audioIncomingRef = useRef(false);

  const completionPendingRef = useRef(false);
  const completeRef = useRef<() => void>(() => {});

  const [isLoading, setIsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstAudioRef = useRef(false);
  const everReceivedAudioRef = useRef(false);
  // Set to true the moment we send a voice clip; cleared once the backend's
  // audio response starts arriving.  Prevents frame sends during the round-trip.
  const voiceResponsePendingRef = useRef(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const tickScale = useRef(new Animated.Value(0.4)).current;

  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFrameTimeRef = useRef<number>(0);

  const frameInFlightRef = useRef(false);
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameDelayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyForFrameRef = useRef(false);

  const [captionText, setCaptionText] = useState("");
  const captionResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const pendingWordsRef = useRef<string[]>([]);
  const wordRevealTimerRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );

  const recordingRef = useRef<Audio.Recording | null>(null);
  const isRecordingRef = useRef(false);
  const [isRecording, setIsRecording] = useState(false);
  const recordingPulse = useRef(new Animated.Value(1)).current;

  const decodeChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingDecodesRef = useRef(0);

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(recordingPulse, {
            toValue: 1.5,
            duration: 700,
            useNativeDriver: true,
          }),
          Animated.timing(recordingPulse, {
            toValue: 1,
            duration: 700,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    } else {
      recordingPulse.stopAnimation();
      recordingPulse.setValue(1);
    }
  }, [isRecording]);

  const s = makeStyles();
  const userId = useRef<string>("");

  const scheduleFrameAfterDelay = useCallback(
    (captureAndSendFn: () => void) => {
      if (frameDelayTimerRef.current) {
        clearTimeout(frameDelayTimerRef.current);
        frameDelayTimerRef.current = null;
      }

      const delay = Math.max(
        FRAME_DELAY_MS - (Date.now() - lastFrameTimeRef.current),
        0,
      );

      frameDelayTimerRef.current = setTimeout(() => {
        frameDelayTimerRef.current = null;

        if (doneRef.current) return;
        if (completionPendingRef.current) return;
        if (isRecordingRef.current) return;
        if (voiceResponsePendingRef.current) return;
        if (audioIncomingRef.current) {
          readyForFrameRef.current = true;
          return;
        }
        if (frameInFlightRef.current) return;

        lastFrameTimeRef.current = Date.now();
        captureAndSendFn();
      }, delay);
    },
    [],
  );

  const onAudioDrained = useCallback(() => {
    if (audioPlaybackTimerRef.current) {
      clearTimeout(audioPlaybackTimerRef.current);
      audioPlaybackTimerRef.current = null;
    }

    audioIncomingRef.current = false;
    pendingAudioBytesRef.current = 0;

    if (completionPendingRef.current) {
      completionPendingRef.current = false;
      completeRef.current();
      return;
    }

    if (readyForFrameRef.current) {
      readyForFrameRef.current = false;

      if (frameDelayTimerRef.current) return;
      if (frameInFlightRef.current) return;

      scheduleFrameAfterDelay(() => {
        captureAndSendImage();
      });
    }
  }, [scheduleFrameAfterDelay]);

  const initAudio = useCallback(() => {
    if (audioContextRef.current) return;

    const ctx = new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = ctx;

    const node = ctx.createBufferQueueSource();
    node.connect(ctx.destination);
    node.start(0);

    node.onEnded = () => {
      if (pendingDecodesRef.current > 0) return;
      // Debounce: the queue can momentarily empty between chunks of the
      // same response while the next chunk is still decoding or in-flight
      // from the backend.  Wait a short period so we don't prematurely
      // treat the response as finished and fire off the next frame.
      if (audioPlaybackTimerRef.current) {
        clearTimeout(audioPlaybackTimerRef.current);
      }
      audioPlaybackTimerRef.current = setTimeout(() => {
        audioPlaybackTimerRef.current = null;
        if (pendingDecodesRef.current > 0) return;
        onAudioDrained();
      }, 300);
    };

    queueNodeRef.current = node;
  }, [onAudioDrained]);

  const accumulatePcm = useCallback(
    (chunk: ArrayBuffer) => {
      if (isRecordingRef.current) return;
      if (voiceResponsePendingRef.current && frameInFlightRef.current) return;
      if (!audioContextRef.current) {
        initAudio();
      }
      if (!firstAudioRef.current) {
        firstAudioRef.current = true;
        setIsLoading(false);
      }
      if (!everReceivedAudioRef.current) {
        everReceivedAudioRef.current = true;
      }
      voiceResponsePendingRef.current = false;
      audioIncomingRef.current = true;

      // Cancel any pending "audio drained" debounce — more audio is arriving.
      if (audioPlaybackTimerRef.current) {
        clearTimeout(audioPlaybackTimerRef.current);
        audioPlaybackTimerRef.current = null;
      }

      const raw = new Uint8Array(chunk);
      const alignedLen = raw.length & ~1;
      if (alignedLen === 0) return;

      const aligned =
        alignedLen === raw.length ? raw : raw.subarray(0, alignedLen);

      const base64 = fromByteArray(aligned);

      const ctx = audioContextRef.current;
      if (!ctx || !queueNodeRef.current) return;

      pendingAudioBytesRef.current += alignedLen;

      pendingDecodesRef.current += 1;
      const capturedCtx = ctx;
      decodeChainRef.current = decodeChainRef.current
        .then(() => capturedCtx.decodePCMInBase64(base64, 24000, 1, false))
        .then((audioBuffer) => {
          pendingDecodesRef.current = Math.max(
            0,
            pendingDecodesRef.current - 1,
          );
          if (doneRef.current || !queueNodeRef.current) return;
          queueNodeRef.current.enqueueBuffer(audioBuffer);
        })
        .catch((err) => {
          pendingDecodesRef.current = Math.max(
            0,
            pendingDecodesRef.current - 1,
          );
          console.warn("decodePCMInBase64 error:", err);
        });
    },
    [initAudio],
  );

  const scheduleAfterAudio = useCallback(() => {
    const durationMs = (pendingAudioBytesRef.current / (24000 * 1 * 2)) * 1000;
    audioIncomingRef.current = false;

    if (audioPlaybackTimerRef.current)
      clearTimeout(audioPlaybackTimerRef.current);

    audioPlaybackTimerRef.current = setTimeout(() => {
      audioPlaybackTimerRef.current = null;
      onAudioDrained();
    }, durationMs + 50);
  }, [onAudioDrained]);

  const interruptAudio = useCallback(() => {
    if (audioPlaybackTimerRef.current) {
      clearTimeout(audioPlaybackTimerRef.current);
      audioPlaybackTimerRef.current = null;
    }
    pendingAudioBytesRef.current = 0;
    audioIncomingRef.current = false;
    readyForFrameRef.current = false;
    decodeChainRef.current = Promise.resolve();
    pendingDecodesRef.current = 0;
    const node = queueNodeRef.current;
    if (node) {
      node.onEnded = null;
      try {
        node.stop(0);
      } catch {}
      queueNodeRef.current = null;
    }
    const ctx = audioContextRef.current;
    if (ctx) {
      try {
        ctx.close();
      } catch {}
      audioContextRef.current = null;
    }
  }, []);

  const startVoiceInput = useCallback(async () => {
    if (isRecordingRef.current || doneRef.current) return;
    const { granted } = await Audio.requestPermissionsAsync();
    if (!granted) return;
    isRecordingRef.current = true;
    setIsRecording(true);
    interruptAudio();
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
      });
      const { recording } = await Audio.Recording.createAsync({
        isMeteringEnabled: false,
        android: {
          extension: ".wav",
          outputFormat: Audio.AndroidOutputFormat.DEFAULT,
          audioEncoder: Audio.AndroidAudioEncoder.DEFAULT,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
        },
        ios: {
          extension: ".wav",
          outputFormat: Audio.IOSOutputFormat.LINEARPCM,
          audioQuality: Audio.IOSAudioQuality.HIGH,
          sampleRate: 16000,
          numberOfChannels: 1,
          bitRate: 256000,
          bitDepthHint: 16,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {},
      });
      recordingRef.current = recording;
    } catch (err) {
      console.warn("startVoiceInput error:", err);
      isRecordingRef.current = false;
      setIsRecording(false);
    }
  }, [interruptAudio]);

  const stopVoiceInput = useCallback(async () => {
    if (!isRecordingRef.current || !recordingRef.current) return;
    isRecordingRef.current = false;
    setIsRecording(false);
    try {
      await recordingRef.current.stopAndUnloadAsync();
      const uri = recordingRef.current.getURI();
      recordingRef.current = null;
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false,
        playsInSilentModeIOS: true,
      });
      initAudio();
      if (uri) {
        const base64 = await FileSystem.readAsStringAsync(uri, {
          encoding: FileSystem.EncodingType.Base64,
        });
        const ws = wsRef.current;
        if (ws && ws.readyState === WebSocket.OPEN && !doneRef.current) {
          ws.send(JSON.stringify({ type: "audio", data: base64 }));
          voiceResponsePendingRef.current = true;
        }
        await FileSystem.deleteAsync(uri, { idempotent: true });
      }
    } catch (err) {
      console.warn("stopVoiceInput error:", err);
    }
  }, [initAudio]);

  const captureAndSendImage = async () => {
    if (frameInFlightRef.current) return;
    if (frameDelayTimerRef.current) return;
    if (audioIncomingRef.current) {
      if (!readyForFrameRef.current) readyForFrameRef.current = true;
      return;
    }
    if (isRecordingRef.current || voiceResponsePendingRef.current) return;
    if (doneRef.current || completionPendingRef.current) return;

    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!cameraRef.current) return;

    frameInFlightRef.current = true;

    try {
      const photo = await cameraRef.current.takeSnapshot({
        quality: 60,
        skipMetadata: true,
      });

      const base64 = await FileSystem.readAsStringAsync(
        `file://${photo.path}`,
        { encoding: FileSystem.EncodingType.Base64 },
      );

      const wsCurrent = wsRef.current;
      if (
        !wsCurrent ||
        wsCurrent.readyState !== WebSocket.OPEN ||
        doneRef.current
      ) {
        frameInFlightRef.current = false;
        return;
      }

      lastFrameTimeRef.current = Date.now();
      wsCurrent.send(base64);
    } catch (err) {
      console.warn("Error capturing/sending image:", err);
      frameInFlightRef.current = false;
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!hasPermission || !task) return;

      doneRef.current = false;
      completionPendingRef.current = false;
      reconnectAttemptsRef.current = 0;

      pendingAudioBytesRef.current = 0;
      firstAudioRef.current = false;
      everReceivedAudioRef.current = false;
      voiceResponsePendingRef.current = false;
      audioIncomingRef.current = false;
      readyForFrameRef.current = false;
      frameInFlightRef.current = false;
      setIsLoading(true);
      setConnectionError(false);

      const stopImages = () => {
        if (frameDelayTimerRef.current) {
          clearTimeout(frameDelayTimerRef.current);
          frameDelayTimerRef.current = null;
        }
        if (frameIntervalRef.current) {
          clearInterval(frameIntervalRef.current);
          frameIntervalRef.current = null;
        }
        frameInFlightRef.current = false;
        readyForFrameRef.current = false;

        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }
        if (captionResetTimerRef.current) {
          clearTimeout(captionResetTimerRef.current);
          captionResetTimerRef.current = null;
        }
        if (wordRevealTimerRef.current) {
          clearInterval(wordRevealTimerRef.current);
          wordRevealTimerRef.current = null;
        }
        pendingWordsRef.current = [];
        setCaptionText("");
      };

      const appendCaption = (text: string) => {
        const newWords = text.trim().split(/\s+/).filter(Boolean);
        // Reset — each transcription chunk replaces the previous caption
        pendingWordsRef.current = newWords;
        setCaptionText("");

        if (captionResetTimerRef.current) {
          clearTimeout(captionResetTimerRef.current);
          captionResetTimerRef.current = null;
        }
        if (wordRevealTimerRef.current) {
          clearInterval(wordRevealTimerRef.current);
          wordRevealTimerRef.current = null;
        }

        wordRevealTimerRef.current = setInterval(() => {
          if (pendingWordsRef.current.length === 0) {
            clearInterval(wordRevealTimerRef.current!);
            wordRevealTimerRef.current = null;
            captionResetTimerRef.current = setTimeout(() => {
              captionResetTimerRef.current = null;
              setCaptionText("");
            }, 8000);
            return;
          }
          const batch = pendingWordsRef.current.splice(0, 3);
          setCaptionText((prev) =>
            prev ? prev + " " + batch.join(" ") : batch.join(" "),
          );
        }, 150);
      };

      const stopAudio = () => {
        audioIncomingRef.current = false;
        pendingAudioBytesRef.current = 0;
        decodeChainRef.current = Promise.resolve();
        pendingDecodesRef.current = 0;

        if (audioPlaybackTimerRef.current) {
          clearTimeout(audioPlaybackTimerRef.current);
          audioPlaybackTimerRef.current = null;
        }

        const node = queueNodeRef.current;
        if (node) {
          node.onEnded = null;
          try {
            node.stop(0);
          } catch {}
          queueNodeRef.current = null;
        }

        const ctx = audioContextRef.current;
        if (ctx) {
          try {
            ctx.close();
          } catch {}
          audioContextRef.current = null;
        }
      };

      const complete = () => {
        if (doneRef.current) return;
        doneRef.current = true;
        stopImages();
        // Play the ding BEFORE tearing down the audio context so iOS
        // audio session is still active and in playback mode.
        if (soundEffects) playDing();
        stopAudio();
        const w = wsRef.current;
        if (w && w.readyState !== WebSocket.CLOSED) w.close();
        setShowCompletion(true);
        Animated.parallel([
          Animated.timing(overlayOpacity, {
            toValue: 1,
            duration: 300,
            useNativeDriver: true,
          }),
          Animated.spring(tickScale, {
            toValue: 1,
            tension: 60,
            friction: 7,
            useNativeDriver: true,
          }),
        ]).start();
        setTimeout(() => {
          toggleTask(task.id);
          router.back();
        }, 1800);
      };

      completeRef.current = complete;

      const scheduleReconnect = () => {
        if (doneRef.current) return;

        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          if (firstAudioRef.current) {
            complete();
          } else {
            setIsLoading(false);
            setConnectionError(true);
          }
          return;
        }

        const attempt = reconnectAttemptsRef.current;
        reconnectAttemptsRef.current += 1;
        const delay = Math.min(
          RECONNECT_BASE_DELAY_MS * Math.pow(2, attempt),
          30000,
        );

        setIsLoading(true);
        console.log(
          `Reconnecting in ${delay}ms (attempt ${attempt + 1}/${MAX_RECONNECT_ATTEMPTS})`,
        );

        reconnectTimerRef.current = setTimeout(() => {
          reconnectTimerRef.current = null;
          if (!doneRef.current) connect();
        }, delay);
      };

      const connect = () => {
        firstAudioRef.current = false;
        userId.current = uuidv4();
        const ws = new WebSocket(`${WS_URL}/${userId.current}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("WebSocket connected");
          ws.send(
            JSON.stringify({
              type: "task",
              task: task.prompt,
              captions: transcriptions,
            }),
          );

          if (!audioIncomingRef.current && pendingAudioBytesRef.current === 0) {
            captureAndSendImage();
          }

          if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
          frameIntervalRef.current = setInterval(() => {
            if (doneRef.current) return;
            if (completionPendingRef.current) return;
            if (isRecordingRef.current) return;
            if (voiceResponsePendingRef.current) return;
            if (frameInFlightRef.current) return;
            if (frameDelayTimerRef.current) return;
            if (audioIncomingRef.current) return;
            if (Date.now() - lastFrameTimeRef.current < FRAME_DELAY_MS) return;

            const wsNow = wsRef.current;
            if (!wsNow || wsNow.readyState !== WebSocket.OPEN) return;

            captureAndSendImage();
          }, 800);

          if (loadingTimeoutRef.current)
            clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = setTimeout(() => {
            loadingTimeoutRef.current = null;
            if (!firstAudioRef.current && !doneRef.current) {
              console.warn("No AI response within 25s — reconnecting");
              ws.close();
            }
          }, 25000);
        };

        ws.onmessage = async (event) => {
          if (ws !== wsRef.current) return;

          if (typeof event.data === "string") {
            try {
              const msg = JSON.parse(event.data);

              if (msg.type === "error") {
                console.warn("Backend error:", msg.message, "— reconnecting");
                stopImages();
                ws.close();
                return;
              }

              if (msg.type === "ready") {
                frameInFlightRef.current = false;

                if (voiceResponsePendingRef.current) return;
                if (isRecordingRef.current) return;
                if (doneRef.current || completionPendingRef.current) return;

                if (audioIncomingRef.current) {
                  readyForFrameRef.current = true;
                  return;
                }

                scheduleFrameAfterDelay(() => {
                  captureAndSendImage();
                });
                return;
              }

              if (
                msg.type === "transcription" &&
                typeof msg.text === "string"
              ) {
                appendCaption(msg.text);
                return;
              }

              if (msg.type === "TASK_COMPLETE") {
                completionPendingRef.current = true;
                stopImages();
                if (pendingAudioBytesRef.current > 0) {
                  scheduleAfterAudio();
                } else {
                  completionPendingRef.current = false;
                  complete();
                }
              }
            } catch {}
          } else if (event.data instanceof ArrayBuffer) {
            accumulatePcm(event.data);
          }
        };

        ws.onerror = () => {
          if (ws.readyState !== WebSocket.CLOSED && !doneRef.current) {
            console.warn("WebSocket error");
          }
        };

        ws.onclose = () => {
          if (ws !== wsRef.current) return;
          if (doneRef.current) return;
          if (completionPendingRef.current) return;
          stopImages();
          scheduleReconnect();
        };
      };

      connect();

      return () => {
        doneRef.current = true;
        completionPendingRef.current = false;
        if (reconnectTimerRef.current) {
          clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        stopImages();
        stopAudio();
        setIsLoading(false);
        const current = wsRef.current;
        if (current && current.readyState !== WebSocket.CLOSED) current.close();
      };
    }, [hasPermission, task?.id, task?.text]),
  );

  if (!task) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.centered}>
          <Text style={s.notFoundText}>Task not found or loading...</Text>
          <Text style={{ color: "#666", marginTop: 10, fontSize: 12 }}>
            Task ID: {id}
          </Text>
          <TouchableOpacity
            style={s.backFallback}
            onPress={() => router.back()}
          >
            <Text style={s.backFallbackText}>Go Back</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.root}>
      {/* Full-screen camera background */}
      <View style={s.cameraWrap}>
        <TaskCamera
          cameraRef={cameraRef}
          device={device}
          hasPermission={hasPermission}
          requestPermission={requestPermission}
        />
      </View>

      {/* Overlay */}
      <SafeAreaView style={s.overlay} pointerEvents="box-none">
        {/* Nav bar */}
        <View style={s.navBar}>
          <TouchableOpacity style={s.backButton} onPress={() => router.back()}>
            <Text style={s.backArrow}>‹</Text>
            <Text style={s.backLabel}>Tasks</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.flipButton}
            onPress={() => setFacing((f) => (f === "back" ? "front" : "back"))}
            accessibilityLabel="Flip camera"
            accessibilityRole="button"
          >
            <Text style={s.flipIcon}>⇄</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      {/* Mic button */}
      {!showCompletion && !connectionError && (
        <View
          style={{
            position: "absolute",
            bottom: 44,
            alignSelf: "center",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {isRecording && (
            <Animated.View
              style={{
                position: "absolute",
                top: -10,
                left: -10,
                right: -10,
                bottom: -10,
                borderRadius: 50,
                backgroundColor: "rgba(220,38,38,0.22)",
                transform: [{ scale: recordingPulse }],
              }}
            />
          )}
          <TouchableOpacity
            onPressIn={startVoiceInput}
            onPressOut={stopVoiceInput}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              paddingHorizontal: 28,
              paddingVertical: 15,
              borderRadius: 40,
              backgroundColor: isRecording ? "#DC2626" : "rgba(0,0,0,0.55)",
              borderWidth: 1.5,
              borderColor: isRecording
                ? "rgba(255,255,255,0.2)"
                : "rgba(255,255,255,0.22)",
            }}
            accessibilityLabel="Hold to speak"
            accessibilityRole="button"
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 15,
                fontWeight: "600",
                letterSpacing: 0.2,
              }}
            >
              {isRecording ? "Listening…" : "Hold to speak"}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Caption overlay */}
      {transcriptions && captionText.length > 0 && (
        <View
          pointerEvents="none"
          style={{
            position: "absolute",
            bottom: 118,
            left: 20,
            right: 20,
            alignItems: "center",
          }}
        >
          <View
            style={{
              backgroundColor: "rgba(0,0,0,0.65)",
              borderRadius: 16,
              paddingHorizontal: 18,
              paddingVertical: 12,
            }}
          >
            <Text
              style={{
                color: "#fff",
                fontSize: 16,
                fontWeight: "500",
                lineHeight: 22,
                textAlign: "center",
              }}
            >
              {captionText}
            </Text>
          </View>
        </View>
      )}

      {/* Loading overlay */}
      {isLoading && !everReceivedAudioRef.current && (
        <View style={loadingStyles.overlay} pointerEvents="none">
          <View style={loadingStyles.card}>
            <ActivityIndicator size="large" color="#2563EB" />
            <Text style={loadingStyles.text}>Getting ready…</Text>
          </View>
        </View>
      )}

      {/* Error overlay */}
      {connectionError && (
        <View style={loadingStyles.overlay}>
          <View style={loadingStyles.card}>
            <Text
              style={[
                loadingStyles.text,
                { color: "#DC2626", marginBottom: 16 },
              ]}
            >
              Could not connect to AI. Please try again.
            </Text>
            <TouchableOpacity onPress={() => router.back()}>
              <Text style={{ color: "#2563EB", fontSize: 16 }}>Go Back</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Completion overlay */}
      {showCompletion && (
        <CompletionOverlay
          overlayOpacity={overlayOpacity}
          tickScale={tickScale}
        />
      )}
    </View>
  );
}
