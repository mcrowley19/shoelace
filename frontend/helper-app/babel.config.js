module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    plugins: [
      // Enables 'worklet' directive for VisionCamera frame processors
      "react-native-worklets-core/plugin",
      // Must be last
      "react-native-reanimated/plugin",
    ],
  };
};
