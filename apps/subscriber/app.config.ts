import type { ExpoConfig } from 'expo/config';

// 시크릿·URL 하드코딩 금지 — API 주소는 EXPO_PUBLIC_API_URL로만.
// 익명 시청 앱이라 로그인(secure-store)·촬영(카메라·이미지피커) 권한 문자열이 없다.
const config: ExpoConfig = {
  name: '가치놀',
  slug: 'gachinol-subscriber',
  scheme: 'gachinol-subscriber',
  version: '0.1.0',
  orientation: 'portrait',
  newArchEnabled: true,
  userInterfaceStyle: 'light',
  ios: { bundleIdentifier: 'kr.gachinol.subscriber', supportsTablet: true },
  android: { package: 'kr.gachinol.subscriber', edgeToEdgeEnabled: true },
  web: { bundler: 'metro', output: 'static' },
  experiments: { typedRoutes: false },
  plugins: ['expo-router', 'expo-video'],
};

export default config;
