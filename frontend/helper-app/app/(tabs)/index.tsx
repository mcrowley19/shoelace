import React from "react";
import {
  View,
  Text,
  ScrollView,
  FlatList,
  Image,
  Dimensions,
  TouchableOpacity,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Colors } from "@/constants/theme";
import { useTasks, Task } from "@/context/tasks-context";
import { makeStyles } from "@/styles/tabs";

const PLACEHOLDER_COLORS: Record<string, string> = {
  programming: "#1E3A5F",
};

const SCREEN_WIDTH = Dimensions.get("window").width;
const CARD_WIDTH = SCREEN_WIDTH * 0.72;
const IMAGE_HEIGHT = 170;
const INFO_HEIGHT = 72;
const CARD_HEIGHT = IMAGE_HEIGHT + INFO_HEIGHT;

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const DAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function getDateLine(): string {
  const now = new Date();
  return `${DAYS[now.getDay()]}, ${now.getDate()} ${MONTHS[now.getMonth()]}`;
}

const TASK_IMAGES: Record<string, any> = {
  "Make toast": require("@/assets/images/toast.png"),
  "Fold clothes": require("@/assets/images/fold_clothes.png"),
  "Tie shoelaces": require("@/assets/images/tie_shoes.png"),
};

export default function HomeScreen() {
  const C = Colors;
  const { tasks } = useTasks();
  const s = makeStyles(C);
  const insets = useSafeAreaInsets();

  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;

  return (
    <ScrollView
      style={s.outer}
      contentContainerStyle={[
        s.outerContent,
        { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 96 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* ── Greeting ── */}
      <View style={s.greetingBlock}>
        <Text style={s.greeting}>{getGreeting()}</Text>
        <Text style={s.dateLine}>{getDateLine()}</Text>
      </View>

      {/* ── The Fundamentals ── */}
      <TaskCarousel
        label="The fundamentals"
        tasks={tasks.filter((t) => t.category === "fundamentals")}
        s={s}
      />

      {/* ── Basic computer skills ── */}
      <TaskCarousel
        label="Basic computer skills"
        tasks={tasks.filter((t) => t.category === "programming")}
        s={s}
      />
    </ScrollView>
  );
}

function TaskCarousel({
  label,
  tasks,
  s,
}: {
  label: string;
  tasks: Task[];
  s: ReturnType<typeof makeStyles>;
}) {
  if (tasks.length === 0) return null;
  return (
    <View style={s.section}>
      <Text style={s.sectionLabel}>{label}</Text>
      <FlatList
        horizontal
        data={tasks}
        keyExtractor={(t) => t.id}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={s.carouselPad}
        snapToInterval={CARD_WIDTH + 14}
        decelerationRate="fast"
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            onPress={() =>
              router.push({
                pathname: "/task/setup/[id]",
                params: { id: item.id },
              })
            }
          />
        )}
      />
    </View>
  );
}

function TaskCard({ task, onPress }: { task: Task; onPress: () => void }) {
  const image = TASK_IMAGES[task.text];
  const placeholderColor = PLACEHOLDER_COLORS[task.category] ?? Colors.primary;

  return (
    <TouchableOpacity
      style={[
        {
          width: CARD_WIDTH,
          height: CARD_HEIGHT,
          borderRadius: 16,
          overflow: "hidden",
          marginRight: 14,
          backgroundColor: "#fff",
        },
        task.completed && { opacity: 0.45 },
      ]}
      onPress={onPress}
      activeOpacity={0.88}
      accessibilityLabel={`${task.text}${task.completed ? ", completed" : ""}, tap to start`}
      accessibilityRole="button"
    >
      {/* Photo or placeholder */}
      {image ? (
        <Image
          source={image}
          style={{ width: CARD_WIDTH, height: IMAGE_HEIGHT }}
          resizeMode="cover"
        />
      ) : (
        <View
          style={{
            width: CARD_WIDTH,
            height: IMAGE_HEIGHT,
            backgroundColor: placeholderColor,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text style={{ fontSize: 48, color: "rgba(255,255,255,0.25)" }}>
            {"</>"}
          </Text>
        </View>
      )}

      {/* Info strip */}
      <View
        style={{
          flex: 1,
          paddingHorizontal: 14,
          paddingVertical: 12,
          justifyContent: "center",
          backgroundColor: "#fff",
        }}
      >
        {task.completed && (
          <Text
            style={{
              fontSize: 10,
              fontWeight: "700",
              color: Colors.success,
              letterSpacing: 0.8,
              textTransform: "uppercase",
              marginBottom: 3,
            }}
          >
            ✔ Completed
          </Text>
        )}
        <Text
          style={{
            color: Colors.text,
            fontSize: 16,
            fontWeight: "700",
            lineHeight: 21,
          }}
          numberOfLines={2}
        >
          {task.text}
        </Text>
        {task.time && (
          <Text
            style={{
              color: Colors.muted,
              fontSize: 12,
              marginTop: 4,
              fontWeight: "500",
            }}
          >
            ◷ {task.time}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
}
