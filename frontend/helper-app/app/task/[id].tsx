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

const INSTRUCTION_COOLDOWN_MS = 200;

export default function TaskDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getTask, toggleTask } = useTasks();
  const task = getTask(id);

  const { hasPermission, requestPermission } = useCameraPermission();
  const cameraRef = useRef<any>(null);
  const [facing, setFacing] = useState<"back" | "front">("back");
  const device = useCameraDevice(facing);

  const wsRef = useRef<WebSocket | null>(null);
  const imageIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const readyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioPlayerRef = useRef<any>(null);
  const doneRef = useRef(false);

  const audioQueueRef = useRef<string[]>([]);
  const isPlayingRef = useRef(false);
  const audioChunkIndexRef = useRef(0);
  const audioIncomingRef = useRef(false);
  // Set when TASK_COMPLETE is received — lets current audio finish before completing.
  const completionPendingRef = useRef(false);
  // Holds the latest complete() function so playNext can call it.
  const completeRef = useRef<() => void>(() => {});

  const [isLoading, setIsLoading] = useState(false);
  const [connectionError, setConnectionError] = useState(false);
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const firstAudioRef = useRef(false);
  const [showCompletion, setShowCompletion] = useState(false);
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const tickScale = useRef(new Animated.Value(0.4)).current;

  const s = makeStyles();
  const userId = useRef<string>("");

  /**
   * Sequentially play audio chunks to prevent overlapping speech.
   * The interval (or "ready" signal) drives the next image capture.
   */
  const scheduleNextFrame = useCallback((delayMs = 100) => {
    if (doneRef.current || completionPendingRef.current) return;
    if (readyTimeoutRef.current) clearTimeout(readyTimeoutRef.current);
    readyTimeoutRef.current = setTimeout(() => {
      readyTimeoutRef.current = null;
      captureAndSendImage();
    }, delayMs);
  }, []);

  const playNext = () => {
    if (doneRef.current) return;
    if (isPlayingRef.current || audioQueueRef.current.length === 0) return;

    isPlayingRef.current = true;
    const uri = audioQueueRef.current.shift()!;

    audioPlayerRef.current?.remove();
    const player = createAudioPlayer({ uri });
    audioPlayerRef.current = player;

    const subscription = player.addListener(
      "playbackStatusUpdate",
      (status: any) => {
        if (status.didJustFinish || status.isLoaded === false) {
          subscription?.remove();
          isPlayingRef.current = false;
          if (audioQueueRef.current.length > 0) {
            playNext();
          } else if (completionPendingRef.current) {
            // All congratulatory audio has played — now complete.
            completionPendingRef.current = false;
            completeRef.current();
          } else {
            // All audio finished — wait before capturing so the user has time to act
            scheduleNextFrame(1500);
          }
        }
      },
    );

    player.play();
  };

  const enqueueAudio = async (chunk: ArrayBuffer) => {
    try {
      if (!firstAudioRef.current) {
        firstAudioRef.current = true;
        setIsLoading(false);
      }
      const bytes = new Uint8Array(chunk);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 8192) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
      }
      const base64 = btoa(binary);
      const uri =
        FileSystem.cacheDirectory + `audio_${audioChunkIndexRef.current++}.wav`;
      await FileSystem.writeAsStringAsync(uri, base64, {
        encoding: FileSystem.EncodingType.Base64,
      });
      audioQueueRef.current.push(uri);
      // Audio is now safely in the queue — lift the incoming guard
      audioIncomingRef.current = false;
      // Cancel any pending frame capture — audio completion will reschedule it
      if (readyTimeoutRef.current) {
        clearTimeout(readyTimeoutRef.current);
        readyTimeoutRef.current = null;
      }
      playNext();
    } catch (err) {
      console.warn("Error enqueuing AI audio:", err);
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
        if (imageIntervalRef.current) {
          clearInterval(imageIntervalRef.current);
          imageIntervalRef.current = null;
        }
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

      userId.current = uuidv4();
      const ws = new WebSocket(`${WS_URL}/${userId.current}`);
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("WebSocket connected");
        ws.send(JSON.stringify({ type: "task", task: task.prompt }));
        captureAndSendImage();
        // If no audio arrives within 45s something has gone wrong (e.g. the
        // Gemini connection timed out on the backend). Close and show an error.
        loadingTimeoutRef.current = setTimeout(() => {
          loadingTimeoutRef.current = null;
          if (!firstAudioRef.current && !doneRef.current) {
            console.warn("No AI response within 45s — aborting");
            doneRef.current = true;
            if (ws.readyState !== WebSocket.CLOSED) ws.close();
            setIsLoading(false);
            setConnectionError(true);
          }
        }, 45000);
      };

      ws.onmessage = (event) => {
        if (typeof event.data === "string") {
          try {
            const msg = JSON.parse(event.data);

            if (msg.type === "error") {
              console.warn("Backend error:", msg.message);
              if (!doneRef.current) {
                doneRef.current = true;
                stopImages();
                setIsLoading(false);
                setConnectionError(true);
              }
              return;
            }

            if (msg.type === "ready") {
              // Only schedule a frame if no audio is playing or incoming — otherwise
              // audio completion will trigger the next capture via scheduleNextFrame.
              if (!isPlayingRef.current && audioQueueRef.current.length === 0 && !audioIncomingRef.current) {
                if (readyTimeoutRef.current)
                  clearTimeout(readyTimeoutRef.current);
                readyTimeoutRef.current = setTimeout(() => {
                  readyTimeoutRef.current = null;
                  captureAndSendImage();
                }, INSTRUCTION_COOLDOWN_MS);
              }
              return;
            }

            if (msg.type === "TASK_COMPLETE") {
              // Stop new frame captures immediately.
              completionPendingRef.current = true;
              stopImages();
              // Let congratulatory audio finish before completing.
              // If there is no audio in flight, complete right away.
              if (!isPlayingRef.current && audioQueueRef.current.length === 0) {
                completionPendingRef.current = false;
                complete();
              }
            }
          } catch {}
        } else if (event.data instanceof ArrayBuffer) {
          audioIncomingRef.current = true;
          enqueueAudio(event.data);
        }
      };

      ws.onerror = () => {
        if (ws.readyState !== WebSocket.CLOSED && !doneRef.current) {
          console.warn("WebSocket error");
        }
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        // Fallback: if the TASK_COMPLETE message was received before onclose,
        // doneRef is already true and complete() is a no-op. If onclose fires
        // first (race condition on mobile) or the message was dropped, this
        // ensures completion still fires. Guard on firstAudioRef so a failed
        // connection before the AI responds doesn't falsely complete the task.
        // Skip if completionPendingRef is set — playNext will call complete()
        // once the audio queue drains.
        if (!completionPendingRef.current && firstAudioRef.current) {
          complete();
        } else if (!firstAudioRef.current && !doneRef.current) {
          // Connection closed before any AI response — show error instead of
          // leaving the user stuck on the loading spinner.
          doneRef.current = true;
          stopImages();
          setIsLoading(false);
          setConnectionError(true);
        }
      };

      return () => {
        doneRef.current = true;
        completionPendingRef.current = false;
        stopImages(); // also clears loadingTimeoutRef
        stopAudio();
        setIsLoading(false);
        if (ws.readyState !== WebSocket.CLOSED) ws.close();
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
            <Text style={[loadingStyles.text, { color: "#DC2626", marginBottom: 16 }]}>
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
