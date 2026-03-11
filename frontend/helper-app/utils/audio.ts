import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

// Module-level reference keeps the player alive until playback finishes.
let _dingPlayer: ReturnType<typeof createAudioPlayer> | null = null;

export async function playDing() {
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
    _dingPlayer = createAudioPlayer(require("@/assets/kakaist-ding-sfx-330333.mp3"));
    _dingPlayer.play();
  } catch (err) {
    console.warn("playDing error:", err);
  }
}
