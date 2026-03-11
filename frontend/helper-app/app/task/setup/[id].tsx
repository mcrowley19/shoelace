import React from "react";
import { View, Text, TouchableOpacity, ScrollView, Image } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useTasks } from "@/context/tasks-context";
import { Colors } from "@/constants/theme";
import { s } from "@/styles/task-setup";

const TASK_IMAGES: Record<string, any> = {
  "Make toast": require("@/assets/images/guides/make_toast_guide.png"),
  "Fold a shirt": require("@/assets/images/guides/shirt_guide.png"),
  "Fold trousers": require("@/assets/images/guides/trousers_guide.png"),
  "Tie shoelaces": require("@/assets/images/guides/tie_shoes_guide.png"),
  "Make tea": require("@/assets/images/guides/tea_guide.png"),
  "Make a bed": require("@/assets/images/guides/make_bed_guide.png"),
  "Open Facebook": require("@/assets/images/guides/computer_guide.png"),
  "Send an email": require("@/assets/images/guides/computer_guide.png"),
  "Search on Google": require("@/assets/images/guides/computer_guide.png"),
};

const PLACEHOLDER_COLORS: Record<string, string> = {
  programming: "#1E3A5F",
};

export default function TaskSetupScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { getTask } = useTasks();
  const task = getTask(id);
  const insets = useSafeAreaInsets();

  if (!task) {
    return (
      <View style={[s.root, s.centered]}>
        <Text style={s.notFound}>Task not found.</Text>
        <TouchableOpacity style={s.fallbackBtn} onPress={() => router.back()}>
          <Text style={s.fallbackBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const image = TASK_IMAGES[task.text];
  const placeholderColor = PLACEHOLDER_COLORS[task.category] ?? Colors.primary;

  return (
    <View style={s.root}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={[
          s.scrollContent,
          { paddingTop: insets.top + 12, paddingBottom: 24 },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* Back button */}
        <TouchableOpacity
          style={s.backButton}
          onPress={() => router.back()}
          accessibilityLabel="Go back"
          accessibilityRole="button"
        >
          <Text style={s.backArrow}>‹</Text>
          <Text style={s.backLabel}>Tasks</Text>
        </TouchableOpacity>

        {/* Title */}
        <Text style={s.title}>{task.text}</Text>

        {image ? (
          <Image source={image} style={s.hero} resizeMode="contain" />
        ) : (
          <View
            style={[
              s.hero,
              {
                backgroundColor: placeholderColor,
                alignItems: "center",
                justifyContent: "center",
              },
            ]}
          >
            <Text style={{ fontSize: 48, color: "rgba(255,255,255,0.25)" }}>
              {"</>"}
            </Text>
          </View>
        )}

        {/* Setup steps */}
        {task.setup && task.setup.length > 0 && (
          <>
            <Text style={s.sectionHeader}>Before you start</Text>
            <View style={s.setupCard}>
              {task.setup.map((step, i) => (
                <View key={i} style={[s.setupRow, i > 0 && s.setupRowBorder]}>
                  <View style={s.bullet} />
                  <Text style={s.setupText}>{step}</Text>
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>

      {/* Start button */}
      <View style={[s.footer, { paddingBottom: insets.bottom + 16 }]}>
        <TouchableOpacity
          style={s.startButton}
          activeOpacity={0.85}
          onPress={() =>
            router.push({ pathname: "/task/[id]", params: { id } })
          }
          accessibilityLabel={`Start ${task.text}`}
          accessibilityRole="button"
        >
          <Text style={s.startButtonText}>Let's go</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}
