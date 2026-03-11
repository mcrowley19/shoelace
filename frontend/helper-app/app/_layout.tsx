import { DefaultTheme, ThemeProvider } from "@react-navigation/native";
import { Stack } from "expo-router";
import * as NavigationBar from "expo-navigation-bar";
import { StatusBar } from "expo-status-bar";
import { useEffect, useState } from "react";
import { Image, Platform, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
} from "react-native-reanimated";

import { TasksProvider } from "@/context/tasks-context";
import { SettingsProvider } from "@/context/settings-context";

export const unstable_settings = {
  anchor: "(tabs)",
};

function LoadingScreen({ onDone }: { onDone: () => void }) {
  const opacity = useSharedValue(1);

  useEffect(() => {
    const timer = setTimeout(() => {
      opacity.value = withTiming(0, { duration: 600 });
      setTimeout(onDone, 600);
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.loading, animatedStyle]}>
      <Image
        source={require("@/assets/images/shoelace.png")}
        style={styles.loadingImage}
        resizeMode="contain"
      />
    </Animated.View>
  );
}

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (Platform.OS === "android") {
      NavigationBar.setVisibilityAsync("hidden");
    }
  }, []);

  return (
    <SettingsProvider>
      <TasksProvider>
        <ThemeProvider value={DefaultTheme}>
          <Stack>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="task/setup/[id]"
              options={{ headerShown: false }}
            />
            <Stack.Screen name="task/[id]" options={{ headerShown: false }} />
          </Stack>
          <StatusBar style="dark" />
          {!ready && <LoadingScreen onDone={() => setReady(true)} />}
        </ThemeProvider>
      </TasksProvider>
    </SettingsProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    backgroundColor: "#ffffff",
    alignItems: "center",
    justifyContent: "center",
  },
  loadingImage: {
    width: "60%",
    height: "60%",
  },
});
