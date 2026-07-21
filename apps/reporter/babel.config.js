module.exports = function (api) {
  api.cache(true);
  return { presets: ['babel-preset-expo'] }; // SDK 50+: expo-router 플러그인은 프리셋에 포함
};
