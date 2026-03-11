import React, { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  Switch,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Colors } from "@/constants/theme";
import { useSettings } from "@/context/settings-context";

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const { soundEffects, setSoundEffects, transcriptions, setTranscriptions } =
    useSettings();

  const [largeText, setLargeText] = useState(false);
  const [notifications, setNotifications] = useState(false);

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
        <Text style={s.title}>Settings</Text>
      </View>

      {/* ── AI Guidance ── */}
      <Text style={s.sectionLabel}>AI Guidance</Text>
      <View style={s.group}>
        <SettingRow
          label="Captions"
          description="Include transcriptions in each AI response"
          value={transcriptions}
          onToggle={setTranscriptions}
        />
        <View style={s.divider} />
        <SettingRow
          label="Sound effects"
          description="Play a sound when a task is completed"
          value={soundEffects}
          onToggle={setSoundEffects}
        />
      </View>

      {/* ── Account ── */}
      <Text style={s.sectionLabel}>Account</Text>
      <View style={s.group}>
        <View style={s.divider} />
        <TouchableOpacity
          style={s.linkRow}
          accessibilityRole="button"
          accessibilityLabel="Privacy policy"
        >
          <Text style={s.linkLabel}>Privacy policy</Text>
          <Text style={s.chevron}>›</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.version}>Helper App · Version 1.0</Text>
    </ScrollView>
  );
}

function SettingRow({
  label,
  description,
  value,
  onToggle,
}: {
  label: string;
  description: string;
  value: boolean;
  onToggle: (v: boolean) => void;
}) {
  return (
    <View style={s.row}>
      <View style={s.rowText}>
        <Text style={s.rowLabel}>{label}</Text>
        <Text style={s.rowDescription}>{description}</Text>
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        trackColor={{ false: "#E2E8F0", true: Colors.primary }}
        thumbColor="#fff"
        accessibilityLabel={label}
        accessibilityRole="switch"
      />
    </View>
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

  sectionLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: C.muted,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 10,
    marginTop: 8,
  },

  group: {
    backgroundColor: "#fff",
    borderRadius: 16,
    marginBottom: 28,
    shadowColor: "rgba(0,0,0,1)",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 6,
    elevation: 2,
  },

  divider: {
    height: 1,
    backgroundColor: "#F1F5F9",
    marginHorizontal: 16,
  },

  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  rowText: { flex: 1 },
  rowLabel: {
    fontSize: 16,
    fontWeight: "600",
    color: C.text,
  },
  rowDescription: {
    fontSize: 13,
    color: C.muted,
    marginTop: 2,
  },

  linkRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  linkLabel: {
    flex: 1,
    fontSize: 16,
    fontWeight: "500",
    color: C.text,
  },
  chevron: {
    fontSize: 20,
    color: C.muted,
    fontWeight: "300",
  },

  version: {
    textAlign: "center",
    fontSize: 13,
    color: C.muted,
    marginTop: 8,
  },
});
