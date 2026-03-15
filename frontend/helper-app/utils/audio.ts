import { Audio } from "expo-av";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

// Module-level reference keeps the player alive until playback finishes.
let _dingPlayer: ReturnType<typeof createAudioPlayer> | null = null;

export async function playDing() {
  try {
    // Reset audio mode to ensure playback works (allowsRecordingIOS may still
    // be true from voice input, which mutes playback on iOS).
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
    });
    await setAudioModeAsync({ playsInSilentMode: true });
    _dingPlayer = createAudioPlayer(require("@/assets/kakaist-ding-sfx-330333.mp3"));
    _dingPlayer.volume = 0.7;
    _dingPlayer.play();
  } catch (err) {
    console.warn("playDing error:", err);
  }
}
