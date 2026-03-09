import React, { useCallback, useRef, useState } from "react";
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
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { useTasks } from "@/context/tasks-context";
import { makeStyles, loadingStyles } from "@/styles/task";
import { v4 as uuidv4 } from "uuid";
import "react-native-get-random-values";
import { useCameraDevice, useCameraPermission } from "@/utils/vision-camera";
import { playDing } from "@/utils/audio";
import TaskCamera from "@/components/TaskCamera";
import CompletionOverlay from "@/components/CompletionOverlay";

const WS_URL = "wss://task-agent-746295074769.europe-west1.run.app/live";

/** Build a WAV file header + PCM body in JS, so the backend can send raw PCM. */
function buildWav(
  pcm: Uint8Array,
  sampleRate = 24000,
  channels = 1,
  bits = 16,
): Uint8Array {
  const dataSize = pcm.length;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const str = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, dataSize + 36, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, channels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, (sampleRate * channels * bits) / 8, true);
  v.setUint16(32, (channels * bits) / 8, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, dataSize, true);
  new Uint8Array(buf, 44).set(pcm);
  return new Uint8Array(buf);
}

const MAX_RECONNECT_ATTEMPTS = 8;
const RECONNECT_BASE_DELAY_MS = 1000;

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getTask, toggleTask } = useTasks();
  const task = getTask(id);

  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<any>(null);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const device = useCameraDevice(facing);

  const wsRef = useRef<WebSocket | null>(null);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioPlayerRef = useRef<any>(null);
  const doneRef = useRef(false);

  const audioQueueRef = useRef<any[]>([]);
  const isPlayingRef = useRef(false);
  const audioChunkIndexRef = useRef(0);
  const audioIncomingRef = useRef(false);
  const pcmAccumulatorRef = useRef<Uint8Array[]>([]);
  const completionPendingRef = useRef(false);
  const completeRef = useRef<() => void>(() => {});

  const [isLoading, setIsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstAudioRef = useRef(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const tickScale = useRef(new Animated.Value(0.4)).current;

  const reconnectAttemptsRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const s = makeStyles();
  const userId = useRef<string>("");

  const scheduleNextFrame = useCallback(() => {
    if (doneRef.current || completionPendingRef.current) return;
    if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
    readyTimeoutRef.current = setTimeout(() => {
      readyTimeoutRef.current = null;
      captureAndSendImage();
    }, 1500);
  }, []);

  const playNext = () => {
    if (doneRef.current) return;
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    isPlayingRef.current = true;
    const player = audioQueueRef.current.shift()!;

    audioPlayerRef.current?.remove();
    audioPlayerRef.current = player;

    let wasLoaded = false;
    const subscription = player.addListener(
      "playbackStatusUpdate",
      (status: any) => {
        if (status.isLoaded) wasLoaded = true;
        if (status.didJustFinish || (status.isLoaded === false && wasLoaded)) {
          subscription?.remove();
          isPlayingRef.current = false;
          if (audioQueueRef.current.length > 0) {
            playNext();
          } else if (completionPendingRef.current) {
            completionPendingRef.current = false;
            completeRef.current();
          } else {
            scheduleNextFrame();
          }
        }
      },
    );

    player.play();
  };

  const accumulatePcm = (chunk: ArrayBuffer) => {
    if (!firstAudioRef.current) {
      firstAudioRef.current = true;
      setIsLoading(false);
    }
    pcmAccumulatorRef.current.push(new Uint8Array(chunk));
    audioIncomingRef.current = true;
  };

  const flushPcmBuffer = async () => {
    const chunks = pcmAccumulatorRef.current;
    pcmAccumulatorRef.current = [];
    audioIncomingRef.current = false;

    if (chunks.length === 0) return;

    // Concatenate chunks and enforce 2-byte alignment for 16-bit samples.
    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const alignedLen = totalLen & ~1;
    if (alignedLen === 0) return;

    const pcm = new Uint8Array(alignedLen);
    let offset = 0;
    for (const chunk of chunks) {
      const copyLen = Math.min(chunk.length, alignedLen - offset);
      pcm.set(chunk.subarray(0, copyLen), offset);
      offset += copyLen;
      if (offset >= alignedLen) break;
    }

    try {
      const wav = buildWav(pcm);
      let binary = "";
      for (let i = 0; i < wav.length; i += 8192) {
        binary += String.fromCharCode(...wav.subarray(i, i + 8192));
      }
      const base64 = btoa(binary);
      const uri =
        FileSystem.cacheDirectory + `audio_${audioChunkIndexRef.current++}.wav`;
      await FileSystem.writeAsStringAsync(uri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      audioQueueRef.current.push(createAudioPlayer({ uri }));
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      playNext();
    } catch (err) {
      console.warn("Error flushing PCM buffer:", err);
    }
  };

  const captureAndSendImage = async () => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePhoto({ flash: "off" });
      const base64 = await FileSystem.readAsStringAsync(
        `file://${photo.path}`,
        { encoding: FileSystem.EncodingType.Base64 },
      );
      ws.send(base64);
    } catch (err) {
      console.warn("Error capturing/sending image:", err);
    }
  };

  useFocusEffect(
    useCallback(() => {
      if (!hasPermission || !task) return;

      doneRef.current = false;
      completionPendingRef.current = false;
      reconnectAttemptsRef.current = 0;

      // Reset audio queue state on new session
      audioQueueRef.current = [];
      isPlayingRef.current = false;
      firstAudioRef.current = false;
      audioChunkIndexRef.current = 0;
      audioIncomingRef.current = false;
      setIsLoading(true);
      setConnectionError(false);
      setAudioModeAsync({ playsInSilentMode: true });

      const stopImages = () => {
        if (readyTimeoutRef.current) {
          clearTimeout(readyTimeoutRef.current);
          readyTimeoutRef.current = null;
        }
        if (loadingTimeoutRef.current) {
          clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = null;
        }
      };

      const stopAudio = () => {
        pcmAccumulatorRef.current = [];
        audioIncomingRef.current = false;
        audioQueueRef.current.forEach((p: any) => p.remove());
        audioQueueRef.current = [];
        isPlayingRef.current = false;
        audioPlayerRef.current?.pause();
        audioPlayerRef.current?.remove();
        audioPlayerRef.current = null;
      };

      const complete = () => {
        if (doneRef.current) return;
        doneRef.current = true;
        stopImages();
        stopAudio();
        const w = wsRef.current;
        if (w && w.readyState !== WebSocket.CLOSED) w.close();
        setShowCompletion(true);
        playDing();
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

      // Keep ref up to date so playNext can call it after audio finishes.
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
        userId.current = uuidv4();
        const ws = new WebSocket(`${WS_URL}/${userId.current}`);
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;

        ws.onopen = () => {
          console.log("WebSocket connected");
          ws.send(JSON.stringify({ type: "task", task: task.prompt }));

          if (
            !isPlayingRef.current &&
            audioQueueRef.current.length === 0 &&
            !audioIncomingRef.current
          ) {
            captureAndSendImage();
          }

          if (loadingTimeoutRef.current)
            clearTimeout(loadingTimeoutRef.current);
          loadingTimeoutRef.current = setTimeout(() => {
            loadingTimeoutRef.current = null;
            if (!firstAudioRef.current && !doneRef.current) {
              console.warn("No AI response within 45s — reconnecting");
              ws.close();
            }
          }, 45000);
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
                await flushPcmBuffer();
                if (
                  !isPlayingRef.current &&
                  audioQueueRef.current.length === 0
                ) {
                  if (readyTimeoutRef.current)
                    clearTimeout(readyTimeoutRef.current);
                  readyTimeoutRef.current = setTimeout(() => {
                    readyTimeoutRef.current = null;
                    captureAndSendImage();
                  }, 0);
                }
                return;
              }

              if (msg.type === "TASK_COMPLETE") {
                completionPendingRef.current = true;
                stopImages();
                await flushPcmBuffer();
                if (
                  !isPlayingRef.current &&
                  audioQueueRef.current.length === 0
                ) {
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

      {/* Loading overlay */}
      {isLoading && (
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
