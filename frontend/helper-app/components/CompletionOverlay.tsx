import React from "react";
import { Animated, Text } from "react-native";
import { s } from "@/styles/completion-overlay";

interface CompletionOverlayProps {
  overlayOpacity: Animated.Value;
  tickScale: Animated.Value;
}

export default function CompletionOverlay({
  overlayOpacity,
  tickScale,
}: CompletionOverlayProps) {
  return (
    <Animated.View
      style={[s.overlay, { opacity: overlayOpacity }]}
      pointerEvents="none"
    >
      <Animated.View
        style={[s.circle, { transform: [{ scale: tickScale }] }]}
      >
        <Text style={s.tick}>✔</Text>
      </Animated.View>
    </Animated.View>
  );
}

