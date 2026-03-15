import { Colors } from "@/constants/theme";

export const TASK_COVER_IMAGES: Record<string, any> = {
  "Make toast": require("@/assets/images/task-covers/toast.png"),
  "Fold a shirt": require("@/assets/images/task-covers/fold_clothes.png"),
  "Fold trousers": require("@/assets/images/task-covers/fold_trousers.png"),
  "Tie shoelaces": require("@/assets/images/task-covers/tie_shoes.png"),
  "Send an email": require("@/assets/images/task-covers/send_email.png"),
  "Search on Google": require("@/assets/images/task-covers/google.png"),
  "Open Facebook": require("@/assets/images/task-covers/open_facebook.png"),
  "Make tea": require("@/assets/images/task-covers/tea.png"),
  "Brush your teeth": require("../assets/images/task-covers/toothpaste.png"),
  "Put in contacts": require("../assets/images/task-covers/contact.png"),
};

export const TASK_GUIDE_IMAGES: Record<string, any> = {
  "Make toast": require("@/assets/images/guides/make_toast_guide.png"),
  "Fold a shirt": require("@/assets/images/guides/shirt_guide.png"),
  "Fold trousers": require("@/assets/images/guides/trousers_guide.png"),
  "Tie shoelaces": require("@/assets/images/guides/tie_shoes_guide.png"),
  "Make tea": require("@/assets/images/guides/tea_guide.png"),
  "Open Facebook": require("@/assets/images/guides/computer_guide.png"),
  "Send an email": require("@/assets/images/guides/computer_guide.png"),
  "Search on Google": require("@/assets/images/guides/computer_guide.png"),
  "Brush your teeth": require("@/assets/images/guides/brush_teeth_guide.png"),
  "Put in contacts": require("../assets/images/guides/contacts_guide.png"),
};

export const CATEGORY_PLACEHOLDER_COLOR: Record<string, string> = {
  programming: "#1E3A5F",
};

export function getPlaceholderColor(category: string): string {
  return CATEGORY_PLACEHOLDER_COLOR[category] ?? Colors.primary;
}
