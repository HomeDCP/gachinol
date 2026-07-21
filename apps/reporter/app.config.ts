import type { ExpoConfig } from 'expo/config';

// 시크릿·URL 하드코딩 금지 — API 주소는 EXPO_PUBLIC_API_URL로만.
const config: ExpoConfig = {
  name: '가치놀 기자',
  slug: 'gachinol-reporter',
  scheme: 'gachinol-reporter',
  version: '0.1.0',
  orientation: 'portrait',
  newArchEnabled: true,
  userInterfaceStyle: 'light',
  ios: { bundleIdentifier: 'kr.gachinol.reporter', supportsTablet: false }, // 스토어 제출 전 확정 (open question)
  android: { package: 'kr.gachinol.reporter', edgeToEdgeEnabled: true },
  experiments: { typedRoutes: false },
  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-video',
    [
      'expo-camera',
      {
        cameraPermission: '현장 촬영을 위해 카메라 접근이 필요합니다.',
        microphonePermission: '현장 음성 녹음을 위해 마이크 접근이 필요합니다.',
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission: '촬영해 둔 영상을 선택하기 위해 사진 보관함 접근이 필요합니다.',
      },
    ],
  ],
};

export default config;
