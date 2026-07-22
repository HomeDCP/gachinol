import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { ApiProvider } from '../src/api-context';
import { FeedFilterProvider } from '../src/feed-filter-context';
import { createQueryClient } from '../src/query/query-client';

// 익명 시청 — 세션 부트스트랩 게이트가 없다. 스플래시는 첫 렌더 직후 즉시 hide.
void SplashScreen.preventAutoHideAsync().catch(() => {});

export default function RootLayout(): React.JSX.Element {
  const [queryClient] = useState(createQueryClient);

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
          </Stack>
        </FeedFilterProvider>
      </ApiProvider>
    </QueryClientProvider>
  );
}
