import React, { createContext, useContext, useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SettingsContextType {
  soundEffects: boolean;
  setSoundEffects: (value: boolean) => void;
  transcriptions: boolean;
  setTranscriptions: (value: boolean) => void;
}

const SettingsContext = createContext<SettingsContextType | null>(null);

const SOUND_EFFECTS_KEY = "@settings/soundEffects";
const TRANSCRIPTIONS_KEY = "@settings/transcriptions";

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [soundEffects, setSoundEffectsState] = useState(true);
  const [transcriptions, setTranscriptionsState] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(SOUND_EFFECTS_KEY).then((val) => {
      if (val !== null) setSoundEffectsState(val === "true");
    });
    AsyncStorage.getItem(TRANSCRIPTIONS_KEY).then((val) => {
      if (val !== null) setTranscriptionsState(val === "true");
    });
  }, []);

  const setSoundEffects = (value: boolean) => {
    setSoundEffectsState(value);
    AsyncStorage.setItem(SOUND_EFFECTS_KEY, String(value));
  };

  const setTranscriptions = (value: boolean) => {
    setTranscriptionsState(value);
    AsyncStorage.setItem(TRANSCRIPTIONS_KEY, String(value));
  };

  return (
    <SettingsContext.Provider value={{ soundEffects, setSoundEffects, transcriptions, setTranscriptions }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettings() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettings must be used within SettingsProvider");
  return ctx;
}
