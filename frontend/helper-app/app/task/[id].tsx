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
import {
  AudioContext,
  AudioBufferQueueSourceNode,
} from "react-native-audio-api";
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
const FRAME_DELAY_MS = 2000;

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
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const doneRef = useRef(false);

  // Audio: Web Audio API streaming via native queue source node
  const audioContextRef = useRef<AudioContext | null>(null);
  const queueNodeRef = useRef<AudioBufferQueueSourceNode | null>(null);
  // Bytes written to native queue since last "ready" signal — used for duration estimation
  const pendingAudioBytesRef = useRef(0);
  // Timer that fires when estimated playback of queued audio is done
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
  const voiceResponsePendingRef = useRef(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const tickScale = useRef(new Animated.Value(0.4)).current;

  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  // Serialises decodePCMInBase64 calls so buffers are enqueued in order.
  const decodeChainRef = useRef<Promise<void>>(Promise.resolve());
  // Counts decode operations still in flight (started but not yet enqueued).
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

  /**
   * Called when all queued audio has drained (either via onBufferEnded or
   * a duration-based timer). Triggers task completion if pending.
   */
  const onAudioDrained = useCallback(() => {
    audioIncomingRef.current = false;

    if (completionPendingRef.current) {
      completionPendingRef.current = false;
      completeRef.current();
      return;
    }

    // Audio finished — capture next frame immediately if ready signal already arrived
    if (readyForFrameRef.current) {
      readyForFrameRef.current = false;
      captureAndSendImage();
    }
  }, []);

  /**
   * Initialise AudioContext + AudioBufferQueueSourceNode for this session.
   * Safe to call multiple times — no-ops if already initialised.
   */
  const initAudio = useCallback(() => {
    if (audioContextRef.current) return;

    // 24 kHz matches the incoming PCM sample rate exactly.
    const ctx = new AudioContext({ sampleRate: 24000 });
    audioContextRef.current = ctx;

    const node = ctx.createBufferQueueSource();
    node.connect(ctx.destination);
    node.start(0);

    // Fires whenever the native queue empties. Guard against calling onAudioDrained
    // while decode operations are still in flight — more buffers will be enqueued
    // shortly and onEnded will fire again when those finish.
    node.onEnded = () => {
      if (audioPlaybackTimerRef.current) {
        clearTimeout(audioPlaybackTimerRef.current);
        audioPlaybackTimerRef.current = null;
      }
      if (pendingDecodesRef.current > 0) return;
      onAudioDrained();
    };

    queueNodeRef.current = node;
  }, [onAudioDrained]);

  /**
   * Receives a raw PCM ArrayBuffer from the WebSocket, 2-byte aligns it,
   * fast-encodes it to base64 via native C++, and enqueues it directly on
   * the native audio buffer — no filesystem, no WAV header, no JS loop.
   */
  const accumulatePcm = useCallback(
    (chunk: ArrayBuffer) => {
      if (isRecordingRef.current) return;
      // Discard stale audio from a frame that was in-flight when voice recording started.
      // Once frameInFlightRef is cleared (by the "ready" signal from the old frame),
      // the next audio is the voice response and should play.
      if (voiceResponsePendingRef.current && frameInFlightRef.current) return;
      if (!audioContextRef.current) {
        initAudio(); // create/recreate context (first time or after interrupt)
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

      // 2-byte align for 16-bit samples
      const raw = new Uint8Array(chunk);
      const alignedLen = raw.length & ~1;
      if (alignedLen === 0) return;

      const aligned =
        alignedLen === raw.length ? raw : raw.subarray(0, alignedLen);

      // C++ base64 — replaces the slow String.fromCharCode loop
      const base64 = fromByteArray(aligned);

      // Enqueue onto the native audio ring buffer
      const ctx = audioContextRef.current;
      if (!ctx || !queueNodeRef.current) return;

      // Serialise decodes so buffers are always enqueued in arrival order.
      pendingDecodesRef.current += 1;
      pendingAudioBytesRef.current += alignedLen;
      const capturedCtx = ctx;
      decodeChainRef.current = decodeChainRef.current
        .then(() => capturedCtx.decodePCMInBase64(base64, 24000, 1, true))
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

  /**
   * Called on TASK_COMPLETE when audio is pending. Sets a timer for the estimated
   * remaining playback duration as a fallback; node.onEnded fires first if audio
   * truly drains before the estimate.
   */
  const scheduleAfterAudio = useCallback(() => {
    const durationMs = (pendingAudioBytesRef.current / (24000 * 1 * 2)) * 1000;
    audioIncomingRef.current = false;

    if (audioPlaybackTimerRef.current)
      clearTimeout(audioPlaybackTimerRef.current);

    audioPlaybackTimerRef.current = setTimeout(() => {
      audioPlaybackTimerRef.current = null;
      onAudioDrained();
    }, durationMs + 50); // 50 ms buffer for native drain jitter
  }, [onAudioDrained]);

  const interruptAudio = useCallback(() => {
    if (audioPlaybackTimerRef.current) {
      clearTimeout(audioPlaybackTimerRef.current);
      audioPlaybackTimerRef.current = null;
    }
    if (readyTimeoutRef.current) {
      clearTimeout(readyTimeoutRef.current);
      readyTimeoutRef.current = null;
    }
    pendingAudioBytesRef.current = 0;
    audioIncomingRef.current = false;
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
  }, []);

  const captureAndSendImage = async () => {
    if (frameInFlightRef.current || frameDelayTimerRef.current) return;
    if (isRecordingRef.current || voiceResponsePendingRef.current) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!cameraRef.current) return;
    try {
      frameInFlightRef.current = true;
      const photo = await cameraRef.current.takeSnapshot({
        quality: 60,
        skipMetadata: true,
      });

      const base64 = await FileSystem.readAsStringAsync(
        `file://${photo.path}`,
        { encoding: FileSystem.EncodingType.Base64 },
      );
      ws.send(base64);
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

      // Reset audio state for new session
      pendingAudioBytesRef.current = 0;
      firstAudioRef.current = false;
      everReceivedAudioRef.current = false;
      voiceResponsePendingRef.current = false;
      audioIncomingRef.current = false;
      readyForFrameRef.current = false;
      setIsLoading(true);
      setConnectionError(false);

      const stopImages = () => {
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current);
          readyTimeoutRef.current = null;
        }
        if (frameDelayTimerRef.current) {
          clearTimeout(frameDelayTimerRef.current);
          frameDelayTimerRef.current = null;
        }
        if (frameIntervalRef.current) {
          clearInterval(frameIntervalRef.current);
          frameIntervalRef.current = null;
        }
        frameInFlightRef.current = false;
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
        pendingWordsRef.current.push(...newWords);

        if (captionResetTimerRef.current) {
          clearTimeout(captionResetTimerRef.current);
          captionResetTimerRef.current = null;
        }

        if (!wordRevealTimerRef.current) {
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
        }
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
        stopAudio();
        const w = wsRef.current;
        if (w && w.readyState !== WebSocket.CLOSED) w.close();
        setShowCompletion(true);
        if (soundEffects) playDing();
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

      // Keep ref up to date so onAudioDrained can call it after audio finishes.
      completeRef.current = complete;

      const scheduleReconnect = () => {
        if (doneRef.current) return;

        if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
          // Exhausted all retries
          if (firstAudioRef.current) {
            // Session was active — treat as complete rather than error
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

        // Restore loading spinner if audio had already started
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

          // Only capture first frame if not mid-playback from a reconnect
          if (!audioIncomingRef.current && pendingAudioBytesRef.current === 0) {
            captureAndSendImage();
          }

          // Fallback timer: keeps frames flowing every 3s if "ready" is slow
          if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
          frameIntervalRef.current = setInterval(() => {
            if (
              doneRef.current ||
              completionPendingRef.current ||
              isRecordingRef.current ||
              voiceResponsePendingRef.current
            )
              return;
            if (frameInFlightRef.current) return;
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
                if (voiceResponsePendingRef.current) {
                  // A frame that was in-flight before voice input just finished.
                  // Don't capture a new frame — the voice response is being processed next.
                  return;
                }
                if (isRecordingRef.current) return;
                if (!doneRef.current && !completionPendingRef.current) {
                  // If audio is still playing, defer frame capture until it drains
                  if (audioIncomingRef.current) {
                    readyForFrameRef.current = true;
                    return;
                  }
                  frameDelayTimerRef.current = setTimeout(
                    captureAndSendImage,
                    FRAME_DELAY_MS,
                  );
                }
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
                  // scheduleAfterAudio → onAudioDrained → complete()
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

          console.log("WebSocket disconnected");

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
        stopImages(); // also clears loadingTimeoutRef
        stopAudio();
        setIsLoading(false);
        // Close the current socket (wsRef.current, not the originally captured ws)
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
            <Text style={{ fontSize: 18 }}>🎤</Text>
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
