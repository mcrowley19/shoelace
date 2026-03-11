import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/theme";
import { useTasks } from "@/context/tasks-context";

export default function CompletedScreen() {
  const { tasks } = useTasks();
  const insets = useSafeAreaInsets();
  const completed = tasks.filter((t) => t.completed);

  return (
    <ScrollView
      style={s.outer}
      contentContainerStyle={[
        s.content,
        { paddingTop: insets.top + 28, paddingBottom: insets.bottom + 96 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={s.header}>
        <Text style={s.title}>Completed</Text>
        <Text style={s.subtitle}>
          {completed.length} skill{completed.length !== 1 ? "s" : ""} learned
        </Text>
      </View>

      {completed.length === 0 ? (
        <View style={s.empty}>
          <Text style={s.emptyIcon}>○</Text>
          <Text style={s.emptyTitle}>Nothing completed yet</Text>
          <Text style={s.emptySubtitle}>
            Skills you learn will appear here.
          </Text>
        </View>
      ) : (
        completed.map((task) => (
          <View key={task.id} style={s.card}>
            <View style={s.tickWrap}>
              <Text style={s.tick}>✔</Text>
            </View>
            <View style={s.cardBody}>
              <Text style={s.taskName}>{task.text}</Text>
              {task.time && <Text style={s.taskTime}>◷ {task.time}</Text>}
            </View>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const C = Colors;

const s = StyleSheet.create({
  outer: { flex: 1, backgroundColor: "#F4F4F6" },
  content: { paddingHorizontal: 24 },

  header: { marginBottom: 28 },
  title: {
    fontSize: 32,
    fontWeight: "700",
    color: C.text,
    letterSpacing: -0.4,
    lineHeight: 38,
  },
  subtitle: {
    fontSize: 15,
    color: C.muted,
    marginTop: 4,
  },

  empty: {
    marginTop: 64,
    alignItems: "center",
    gap: 8,
  },
  emptyIcon: {
    fontSize: 48,
    color: C.cardBorder,
    marginBottom: 8,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: C.text,
  },
  emptySubtitle: {
    fontSize: 14,
    color: C.muted,
    textAlign: "center",
  },

  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
    gap: 14,
    shadowColor: "rgba(0,0,0,1)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },
  tickWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: C.successLight,
    alignItems: "center",
    justifyContent: "center",
  },
  tick: {
    fontSize: 16,
    color: C.success,
    fontWeight: "700",
  },
  cardBody: { flex: 1 },
  taskName: {
    fontSize: 16,
    fontWeight: "600",
    color: C.text,
  },
  taskTime: {
    fontSize: 13,
    color: C.muted,
    marginTop: 2,
  },
});
