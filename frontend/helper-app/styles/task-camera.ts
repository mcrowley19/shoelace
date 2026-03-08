import { StyleSheet } from "react-native";
import { Colors } from "@/constants/theme";

export const s = StyleSheet.create({
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    gap: 14,
  },
  camera: { flex: 1 },
  viewfinder: {
    position: "absolute",
    top: "18%",
    left: "8%",
    right: "8%",
    bottom: "22%",
    borderRadius: 24,
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.25)",
  },
  permissionText: { color: Colors.muted, fontSize: 15, textAlign: "center" },
  permissionBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 14,
  },
  permissionBtnText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
