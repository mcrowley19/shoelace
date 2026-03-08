import React from "react";
import { View, Text, TouchableOpacity } from "react-native";
import { Camera } from "@/utils/vision-camera";
import { s } from "@/styles/task-camera";

interface TaskCameraProps {
  cameraRef: React.RefObject<any>;
  device: any;
  hasPermission: boolean;
  requestPermission: () => void;
}

export default function TaskCamera({
  cameraRef,
  device,
  hasPermission,
  requestPermission,
}: TaskCameraProps) {
  if (!Camera) {
    return (
      <View style={s.placeholder}>
        <Text style={s.permissionText}>
          Camera requires native build. Use: npx expo run:android
        </Text>
      </View>
    );
  }

  if (!hasPermission) {
    return (
      <View style={s.placeholder}>
        <Text style={s.permissionText}>
          Camera access is needed for AI guidance
        </Text>
        <TouchableOpacity
          style={s.permissionBtn}
          onPress={requestPermission}
          accessibilityLabel="Allow camera access"
          accessibilityRole="button"
        >
          <Text style={s.permissionBtnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!device) return <View style={s.placeholder} />;

  return (
    <>
      <Camera ref={cameraRef} style={s.camera} device={device} isActive photo />
      <View style={s.viewfinder} pointerEvents="none" />
    </>
  );
}

