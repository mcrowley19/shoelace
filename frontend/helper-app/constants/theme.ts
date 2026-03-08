import { Platform } from "react-native";

export const Colors = {
  text: "#0F172A",
  background: "#FFFFFF",
  tint: "#2563EB",
  icon: "#2563EB",
  tabIconDefault: "#93C5FD",
  tabIconSelected: "#2563EB",
  card: "#FFFFFF",
  cardBorder: "#BFDBFE",
  primary: "#2563EB",
  primaryLight: "#EFF6FF",
  secondary: "#14B8A6",
  secondaryLight: "#CCFBF1",
  success: "#22C55E",
  successLight: "#DCFCE7",
  muted: "#64748B",
  headerBg: "#2563EB",
  headerText: "#FFFFFF",
  inputBg: "#F8FAFC",
  shadow: "rgba(37, 99, 235, 0.15)",
};

export const Fonts = Platform.select({
  ios: {
    sans: "system-ui",
    serif: "ui-serif",
    rounded: "ui-rounded",
    mono: "ui-monospace",
  },
  default: {
    sans: "normal",
    serif: "serif",
    rounded: "normal",
    mono: "monospace",
  },
  web: {
    sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
    serif: "Georgia, 'Times New Roman', serif",
    rounded:
      "'SF Pro Rounded', 'Hiragino Maru Gothic ProN', Meiryo, 'MS PGothic', sans-serif",
    mono: "SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
  },
});
