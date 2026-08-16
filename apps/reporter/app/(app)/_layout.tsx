import { Redirect, Stack } from 'expo-router';
import { useSession } from '../../src/auth/auth-context';

/** 세션 가드 — role 게이트(기자 전용)는 AuthProvider가 입구에서 처리 */
export default function AppLayout(): React.JSX.Element | null {
  const { session } = useSession();
  if (session.status === 'loading') return null;
  if (session.status !== 'signedIn') return <Redirect href="/login" />;
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: '콘텐츠' }} />
      <Stack.Screen name="contents/new" options={{ headerShown: false }} />
      <Stack.Screen name="contents/[id]/index" options={{ title: '콘텐츠 상세' }} />
      <Stack.Screen name="contents/[id]/edit" options={{ title: '초안 수정' }} />
      <Stack.Screen name="contents/[id]/preview" options={{ title: '프리뷰 확인' }} />
      <Stack.Screen name="resident-uploads/index" options={{ title: '주민 업로드 검수' }} />
      <Stack.Screen name="resident-uploads/[id]" options={{ title: '검수 상세' }} />
    </Stack>
  );
}
