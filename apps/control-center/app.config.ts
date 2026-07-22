import type { ExpoConfig } from 'expo/config';

// 시크릿·URL 하드코딩 금지 — API 주소는 EXPO_PUBLIC_API_URL로만.
// 촬영·업로드가 없는 관제 앱이라 카메라·이미지피커 권한 문자열이 없다.
const config: ExpoConfig = {
  name: '가치놀 관제',
  slug: 'gachinol-control-center',
  scheme: 'gachinol-control-center',
  version: '0.1.0',
  orientation: 'portrait',
  newArchEnabled: true,
  userInterfaceStyle: 'light',
  // 대시보드 성격상 태블릿 허용 (센터 관제 화면)
  ios: { bundleIdentifier: 'kr.gachinol.controlcenter', supportsTablet: true },
  android: { package: 'kr.gachinol.controlcenter', edgeToEdgeEnabled: true },
  experiments: { typedRoutes: false },
  plugins: ['expo-router', 'expo-secure-store', 'expo-video'],
};

export default config;
