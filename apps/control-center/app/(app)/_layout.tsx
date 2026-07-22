import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/auth/auth-context';
import { BoardFilterProvider } from '../../src/board/board-filter-context';

/** 세션 가드 — role 게이트(센터 전용)는 AuthProvider가 입구에서 처리 */
export default function AppLayout(): React.JSX.Element | null {
  const { session } = useSession();
  if (session.status === 'loading') return null;
  if (session.status !== 'signedIn') return <Redirect href="/login" />;
  return (
    <BoardFilterProvider>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="contents/[id]" options={{ title: '콘텐츠 검토' }} />
      </Stack>
    </BoardFilterProvider>
  );
}
