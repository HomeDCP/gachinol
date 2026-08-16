import '../src/global.css';
import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '../src/api-context';
import { FeedFilterProvider } from '../src/feed-filter-context';
import { createQueryClient } from '../src/query/query-client';
import { useAppUpdate } from '../src/pwa/use-app-update';
import { AppUpdateBanner } from '../src/ui/app-update-banner';

// 익명 시청 — 세션 부트스트랩 게이트가 없다. 스플래시는 첫 렌더 직후 즉시 hide.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout(): React.JSX.Element {
  const [queryClient] = useState(createQueryClient);
  // PWA 서비스워커 등록 + 새 버전 알림 (T-W1-04, 02 §D-T5). 웹 전용 — 네이티브 빌드에서는
  // Metro가 `register-service-worker.ts`(no-op)를 골라 null을 돌려주므로 배너도 구독도 없다.
  const { updateReady, applying, applyUpdate } = useAppUpdate();

  useEffect(() => {
    void SplashScreen.hideAsync().catch(() => {});
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ApiProvider>
        <FeedFilterProvider>
          <StatusBar style="dark" />
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="watch/[id]" options={{ headerShown: true, title: '시청' }} />
            <Stack.Screen name="live/[id]" options={{ headerShown: true, title: '라이브' }} />
          </Stack>
          <AppUpdateBanner visible={updateReady} applying={applying} onApply={applyUpdate} />
        </FeedFilterProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
