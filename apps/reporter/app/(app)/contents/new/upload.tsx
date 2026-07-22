import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { toId } from '@gachinol/shared';
import type { ContentId } from '@gachinol/shared';
import { useDraft } from '../../../../src/features/contents/draft-context';
import { UploadAbortedError } from '../../../../src/upload/upload-service';
import type { UploadProgress } from '../../../../src/upload/upload-service';
import { useUploadService } from '../../../../src/upload/use-upload-service';
import { Button } from '../../../../src/ui/button';
import { ProgressBar } from '../../../../src/ui/progress-bar';
import { Screen } from '../../../../src/ui/screen';
import { colors, spacing, typo } from '../../../../src/ui/theme';

type UploadPhase = 'running' | 'done' | 'aborted' | 'failed';

/** ③-4 업로드 진행 (Mock) — 서버 상태를 바꾸지 않는다 (콘텐츠는 draft 유지) */
export default function UploadScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contentId: ContentId | null = id ? toId<ContentId>(id) : null;
  const { media: draftMedia } = useDraft();
  const uploadService = useUploadService();
  // 상세 화면의 [업로드 시작] 경유(위저드 메모리 없음) — 원본 없이 진입 시 placeholder
  const media = useMemo(
    () =>
      draftMedia ?? {
        uri: 'mock://placeholder',
        fileName: '원본 영상',
        mimeType: 'video/mp4',
        sizeBytes: 0,
      },
    [draftMedia],
  );
  const [progress, setProgress] = useState<UploadProgress>({
    loadedBytes: 0,
    totalBytes: 1,
    ratio: 0,
  });
  const [phase, setPhase] = useState<UploadPhase>('running');
  const abortRef = useRef<AbortController | null>(null);
  const startedRef = useRef(false);
  const navigation = useNavigation();

  // 위저드 내부 pop 차단 — headerBackVisible:false만으로는 Android 하드웨어 백이 막히지 않아
  // scenes/classify로 복귀 후 '초안 저장' 재클릭 → 중복 초안 생성이 가능했다.
  // GO_BACK/POP만 가로챈다 (router.replace의 REPLACE는 통과 — 상세 이동·위저드 종료는 정상 동작).
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      const type = e.data.action.type;
      if (type !== 'GO_BACK' && type !== 'POP') return;
      e.preventDefault();
      // 업로드 완료·중단 후의 뒤로가기는 상세 화면으로 보낸다 (진행 중에는 '취소' 버튼 사용)
      if (phase !== 'running') {
        if (contentId) router.replace(`/contents/${contentId}`);
        else router.replace('/');
      }
    });
    return unsubscribe;
  }, [navigation, phase, contentId]);

  useEffect(() => {
    if (startedRef.current || !contentId || !media) return;
    startedRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    uploadService
      .upload(
        {
          contentId,
          fileUri: media.uri,
          fileName: media.fileName,
          mimeType: media.mimeType,
          sizeBytes: media.sizeBytes,
        },
        setProgress,
        controller.signal,
      )
      .then(() => setPhase('done'))
      .catch((err: unknown) => {
        setPhase(err instanceof UploadAbortedError ? 'aborted' : 'failed');
      });
    return () => controller.abort();
  }, [contentId, media, uploadService]);

  const goDetail = (): void => {
    if (contentId) router.replace(`/contents/${contentId}`);
    else router.replace('/');
  };

  if (!contentId) {
    return (
      <Screen>
        <View style={styles.container}>
          <Text style={styles.message}>업로드할 콘텐츠 정보가 없습니다.</Text>
          <Button label="목록으로" variant="secondary" onPress={() => router.replace('/')} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.fileName}>{media.fileName}</Text>
        <ProgressBar ratio={progress.ratio} />
        <Text style={styles.percent}>{Math.round(progress.ratio * 100)}%</Text>
        {phase === 'running' ? (
          <Button label="취소" variant="secondary" onPress={() => abortRef.current?.abort()} />
        ) : null}
        {phase === 'done' ? (
          <>
            <Text style={styles.message}>
              업로드 완료 — 자동편집·프리뷰 생성이 시작됩니다. 준비되면 확인 요청이 옵니다.
            </Text>
            <Button label="상세 보기" onPress={goDetail} />
          </>
        ) : null}
        {phase === 'aborted' ? (
          <>
            <Text style={styles.message}>업로드를 취소했습니다.</Text>
            <Button label="상세 보기" onPress={goDetail} />
          </>
        ) : null}
        {phase === 'failed' ? (
          <>
            <Text style={styles.message}>업로드 중 오류가 발생했습니다. 다시 시도해 주세요.</Text>
            <Button label="상세 보기" onPress={goDetail} />
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  fileName: { fontSize: typo.body, color: colors.text, textAlign: 'center' },
  percent: { fontSize: typo.title, fontWeight: '700', color: colors.text, textAlign: 'center' },
  message: { fontSize: typo.body, color: colors.textMuted, lineHeight: 22, textAlign: 'center' },
});
