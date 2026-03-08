import { Platform, StyleSheet } from "react-native";
import { Colors } from "@/constants/theme";

const C = Colors;

export function makeStyles() {
  const shadow = Platform.select({
    ios: {
      shadowColor: C.shadow,
      shadowOffset: { width: 0, height: 5 },
      shadowOpacity: 1,
      shadowRadius: 14,
    },
    android: { elevation: 6 },
    default: {},
  });

  return StyleSheet.create({
    root: { flex: 1, backgroundColor: "#000" },
    safe: { flex: 1, backgroundColor: C.background },
    overlay: {
      ...StyleSheet.absoluteFillObject,
      justifyContent: "space-between",
    },

    centered: {
      flex: 1,
      alignItems: "center",
      justifyContent: "center",
      padding: 24,
    },
    notFoundText: { fontSize: 18, color: C.muted, marginBottom: 20 },
    backFallback: {
      backgroundColor: C.primary,
      paddingHorizontal: 28,
      paddingVertical: 14,
      borderRadius: 16,
    },
    backFallbackText: { color: "#fff", fontSize: 17, fontWeight: "700" },

    // Nav
    navBar: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      paddingHorizontal: 12,
      paddingTop: Platform.OS === "android" ? 44 : 8,
      paddingBottom: 4,
    },
    flipButton: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: "rgba(0,0,0,0.45)",
      alignItems: "center",
      justifyContent: "center",
    },
    flipIcon: {
      fontSize: 22,
      color: "#fff",
      fontWeight: "600",
    },
    backButton: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: "rgba(0,0,0,0.45)",
      paddingVertical: 10,
      paddingHorizontal: 16,
      borderRadius: 24,
      gap: 4,
    },
    backArrow: {
      fontSize: 28,
      color: "#fff",
      fontWeight: "300",
      lineHeight: 32,
      marginTop: -1,
    },
    backLabel: { fontSize: 17, color: "#fff", fontWeight: "600" },

    // Camera
    cameraWrap: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: "#000",
    },
    titleWrap: {
      paddingHorizontal: 24,
      paddingTop: 28,
      paddingBottom: 44,
      backgroundColor: "rgba(0,0,0,0.55)",
    },
    cameraOverlay: {
      flex: 1,
      padding: 12,
      justifyContent: "flex-end",
    },
    aiBadge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: "rgba(0,0,0,0.55)",
      borderRadius: 20,
      paddingHorizontal: 12,
      paddingVertical: 6,
      gap: 7,
    },
    aiDot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: C.success,
    },
    aiDotLoading: { backgroundColor: C.primary },
    aiBadgeText: { color: "#fff", fontSize: 13, fontWeight: "600" },
    // Content
    scroll: { flex: 1 },
    scrollContent: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },

    // AI guidance
    guidanceCard: {
      backgroundColor: C.card,
      borderRadius: 16,
      padding: 16,
      marginBottom: 20,
      borderWidth: 1,
      borderColor: C.primary,
    },
    guidanceLabel: {
      fontSize: 12,
      fontWeight: "700",
      color: C.primary,
      marginBottom: 6,
      letterSpacing: 0.5,
      textTransform: "uppercase",
    },
    guidanceText: { fontSize: 16, color: C.text, lineHeight: 24 },

    timeBadge: {
      flexDirection: "row",
      alignItems: "center",
      alignSelf: "flex-start",
      backgroundColor: C.primaryLight,
      paddingHorizontal: 16,
      paddingVertical: 9,
      borderRadius: 24,
      gap: 8,
      marginBottom: 18,
    },
    timeBadgeText: { fontSize: 16, fontWeight: "700", color: C.primary },

    taskLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: "rgba(255,255,255,0.55)",
      letterSpacing: 1.2,
      textTransform: "uppercase",
      marginBottom: 6,
    },
    taskTitle: {
      fontSize: 32,
      fontWeight: "800",
      color: "#fff",
      lineHeight: 42,
      letterSpacing: -0.5,
    },
    taskTitleDone: { color: C.muted, textDecorationLine: "line-through" },

    completionBanner: {
      flexDirection: "row",
      alignItems: "center",
      backgroundColor: C.successLight,
      borderRadius: 16,
      paddingHorizontal: 18,
      paddingVertical: 14,
      marginBottom: 20,
      gap: 12,
    },
    completionIcon: { fontSize: 20, color: C.success },
    completionText: { fontSize: 17, color: C.success, fontWeight: "700" },

    divider: {
      height: 1,
      backgroundColor: C.cardBorder,
      marginVertical: 4,
      marginBottom: 28,
    },

    actionButton: {
      borderRadius: 20,
      paddingVertical: 22,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 12,
      marginBottom: 16,
      ...shadow,
    },
    actionButtonComplete: { backgroundColor: C.success },
    actionButtonUndo: {
      backgroundColor: C.primaryLight,
      borderWidth: 2,
      borderColor: C.primary,
    },
    actionButtonIcon: { fontSize: 24, color: "#fff", fontWeight: "700" },
    actionButtonIconUndo: { color: C.primary },
    actionButtonText: { fontSize: 21, fontWeight: "800", color: "#fff" },
    actionButtonTextUndo: { color: C.primary },

  });
}

export const loadingStyles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  card: {
    backgroundColor: "#fff",
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 40,
    alignItems: "center",
    gap: 16,
  },
  text: {
    fontSize: 17,
    fontWeight: "600",
    color: "#1e293b",
  },
});
