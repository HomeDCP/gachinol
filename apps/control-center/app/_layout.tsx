import { useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { QueryClientProvider } from '@tanstack/react-query';
import { AuthProvider, useSession } from '../src/auth/auth-context';
import { createQueryClient } from '../src/query/query-client';
import { ErrorView } from '../src/ui/error-view';
import { FeedbackHost } from '../src/ui/feedback';

// 세션 판정(loading) 동안 스플래시 유지
void SplashScreen.preventAutoHideAsync().catch(() => {});

function RootNavigator(): React.JSX.Element | null {
  const { session, retryBootstrap } = useSession();

  useEffect(() => {
    if (session.status !== 'loading') {
      void SplashScreen.hideAsync().catch(() => {});
    }
  }, [session.status]);

  if (session.status === 'loading') return null;
  if (session.status === 'error') {
    // 부트스트랩 네트워크 실패 — 오프라인에서 세션을 태우지 않는다
    return <ErrorView message="서버에 연결할 수 없습니다" onRetry={retryBootstrap} />;
  }
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout(): React.JSX.Element {
  const [queryClient] = useState(createQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <StatusBar style="dark" />
        <RootNavigator />
        {/* 웹 토스트·확인 모달 호스트 — 네이티브에서는 렌더 0(OS 다이얼로그가 담당) */}
        <FeedbackHost />
      </AuthProvider>
    </QueryClientProvider>
  );
}
