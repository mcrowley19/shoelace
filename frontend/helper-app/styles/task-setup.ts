import { Platform, StyleSheet } from "react-native";
import { Colors } from "@/constants/theme";

export const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.background },
  centered: { alignItems: "center", justifyContent: "center", padding: 24 },
  notFound: { fontSize: 18, color: Colors.muted, marginBottom: 20 },
  fallbackBtn: {
    backgroundColor: Colors.primary,
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 16,
  },
  fallbackBtnText: { color: "#fff", fontSize: 17, fontWeight: "700" },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20 },

  backButton: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    marginBottom: 20,
    gap: 4,
  },
  backArrow: {
    fontSize: 28,
    color: Colors.text,
    fontWeight: "300",
    lineHeight: 32,
    marginTop: -1,
  },
  backLabel: { fontSize: 17, color: Colors.text, fontWeight: "600" },

  hero: {
    width: "100%",
    height: 140,
    borderRadius: 20,
    marginBottom: 20,
    overflow: "hidden",
  },

  timeBadge: {
    alignSelf: "flex-start",
    backgroundColor: Colors.primaryLight,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
    marginBottom: 12,
  },
  timeBadgeText: { fontSize: 14, fontWeight: "700", color: Colors.primary },

  title: {
    fontSize: 34,
    fontWeight: "800",
    color: Colors.text,
    lineHeight: 42,
    letterSpacing: -0.5,
    marginBottom: 28,
  },

  sectionHeader: {
    fontSize: 13,
    fontWeight: "700",
    color: Colors.muted,
    letterSpacing: 0.8,
    textTransform: "uppercase",
    marginBottom: 12,
  },

  setupCard: {
    backgroundColor: Colors.card,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.cardBorder,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  setupRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: 14,
    gap: 12,
  },
  setupRowBorder: {
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  bullet: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: Colors.primary,
    marginTop: 9,
    flexShrink: 0,
  },
  setupText: {
    flex: 1,
    fontSize: 17,
    color: Colors.text,
    lineHeight: 26,
  },

  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    backgroundColor: Colors.background,
    borderTopWidth: 1,
    borderTopColor: Colors.cardBorder,
  },
  startButton: {
    backgroundColor: Colors.success,
    borderRadius: 20,
    paddingVertical: 22,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: {
        shadowColor: "rgba(34, 197, 94, 0.4)",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 1,
        shadowRadius: 16,
      },
      android: { elevation: 6 },
    }),
  },
  startButtonText: {
    fontSize: 21,
    fontWeight: "800",
    color: "#fff",
  },
});
