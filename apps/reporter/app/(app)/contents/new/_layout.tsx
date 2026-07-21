import { useEffect } from 'react';
import { Alert } from 'react-native';
import { Stack, useNavigation } from 'expo-router';
import { DraftProvider, useDraft } from '../../../../src/features/contents/draft-context';

function WizardStack(): React.JSX.Element {
  const navigation = useNavigation();
  const { isDirtyRef } = useDraft();

  // 이탈 확인 — 작성 중 내용이 있고 저장 전이면 다이얼로그.
  // state가 아닌 ref 판독: 초안 저장 성공(markSaved) 직후의 router.replace는
  // savedContentId 커밋·리스너 재구독 전에 dispatch되므로 state 클로저는 stale(true)이다.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!isDirtyRef.current) return;
      e.preventDefault();
      Alert.alert('작성을 그만둘까요?', '저장하지 않은 내용은 사라집니다.', [
        { text: '계속 작성', style: 'cancel' },
        {
          text: '나가기',
          style: 'destructive',
          onPress: () => navigation.dispatch(e.data.action),
        },
      ]);
    });
    return unsubscribe;
  }, [navigation, isDirtyRef]);

  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: '새 콘텐츠 — 촬영' }} />
      <Stack.Screen name="scenes" options={{ title: '장면 기입' }} />
      <Stack.Screen name="classify" options={{ title: '분류·저장' }} />
      {/* 저장 완료 후 위저드 복귀 차단 — 헤더 버튼 숨김 + iOS 엣지 스와이프 비활성
          (Android 하드웨어 백은 upload 화면의 beforeRemove가 차단) */}
      <Stack.Screen
        name="upload"
        options={{ title: '업로드', headerBackVisible: false, gestureEnabled: false }}
      />
    </Stack>
  );
}

export default function NewContentLayout(): React.JSX.Element {
  return (
    <DraftProvider>
      <WizardStack />
    </DraftProvider>
  );
}
