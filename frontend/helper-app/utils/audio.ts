import { createAudioPlayer, setAudioModeAsync } from "expo-audio";

export async function playDing() {
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
    const player = createAudioPlayer(require("@/assets/kakaist-ding-sfx-330333.mp3"));
    player.play();
  } catch (err) {
    console.warn("playDing error:", err);
  }
}
