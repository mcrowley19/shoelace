import { StyleSheet } from "react-native";

export const s = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(34, 197, 94, 0.92)",
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    width: 160,
    height: 160,
    borderRadius: 80,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    fontSize: 90,
    color: "#22C55E",
    fontWeight: "800",
  },
});
