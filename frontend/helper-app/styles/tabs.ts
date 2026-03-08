import { StyleSheet } from "react-native";
import { Colors } from "@/constants/theme";

export function makeStyles(C: typeof Colors) {
  return StyleSheet.create({
    outer: { flex: 1, backgroundColor: "#F4F4F6" },
    outerContent: { paddingBottom: 56 },

    // Greeting
    greetingBlock: {
      paddingHorizontal: 24,
      marginBottom: 32,
    },
    greeting: {
      color: C.text,
      fontSize: 32,
      fontWeight: "700",
      letterSpacing: -0.4,
      lineHeight: 38,
    },
    dateLine: {
      color: C.muted,
      fontSize: 15,
      fontWeight: "400",
      marginTop: 4,
    },

    // Sections
    section: {
      marginBottom: 32,
    },
    sectionLabel: {
      fontSize: 11,
      fontWeight: "700",
      color: C.muted,
      letterSpacing: 1.4,
      textTransform: "uppercase",
      marginBottom: 14,
      paddingHorizontal: 24,
    },
    carouselPad: {
      paddingHorizontal: 24,
    },

    // Placeholder
    comingSoon: {
      paddingHorizontal: 24,
      fontSize: 14,
      color: C.muted,
    },

    // Progress card
    progressCard: {
      marginHorizontal: 24,
      marginBottom: 32,
      backgroundColor: "#fff",
      borderRadius: 20,
      padding: 20,
      shadowColor: "rgba(0,0,0,1)",
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.06,
      shadowRadius: 12,
      elevation: 3,
    },
    progressCardHeader: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14,
    },
    progressCardTitle: {
      fontSize: 15,
      fontWeight: "600",
      color: C.text,
    },
    progressCardBadge: {
      fontSize: 15,
      fontWeight: "700",
    },
    progressTrack: {
      height: 8,
      backgroundColor: C.primaryLight,
      borderRadius: 4,
      overflow: "hidden",
      marginBottom: 10,
    },
    progressFill: {
      height: 8,
      borderRadius: 4,
    },
    progressCaption: {
      fontSize: 13,
      color: C.muted,
      fontWeight: "500",
    },

    // Encouragement card
    encourageCard: {
      marginHorizontal: 24,
      marginBottom: 16,
      borderRadius: 16,
      padding: 18,
      borderWidth: 1,
    },
    encourageText: {
      fontSize: 15,
      fontWeight: "600",
      lineHeight: 22,
    },
  });
}
