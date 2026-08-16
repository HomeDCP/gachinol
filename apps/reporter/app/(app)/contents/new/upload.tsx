import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { toId } from '@gachinol/shared';
import type { ContentId } from '@gachinol/shared';
import { useDraft } from '../../../../src/features/contents/draft-context';
import { useUploadFunnelEvents } from '../../../../src/telemetry/use-upload-funnel-events';
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
  const funnelEvents = useUploadFunnelEvents();
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

  // 위저드 단계 진입/이탈(02§E-16 업로드퍼널 트랙) — contentId 없이 진입(예: 잘못된 딥링크)한
  // 세션은 upload_complete를 낼 수 없어 wizardCompletionRate 분모만 늘린다(하향 편향) → 발신하지 않는다.
  useEffect(() => {
    if (!contentId) return;
    funnelEvents.wizardStepEnter('upload', contentId);
    return () => funnelEvents.wizardStepExit('upload', contentId);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 마운트당 1회만(진입/이탈), contentId는 라우트 param이라 마운트 후 불변
  }, []);

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

  /** 업로드 1회 시도 — 최초 진입(kind='start')과 실패 후 재시도(kind='resume')가 공유하는 실행 경로 */
  const runUpload = useCallback(
    (kind: 'start' | 'resume'): void => {
      if (!contentId || !media) return;
      setPhase('running');
      setProgress({ loadedBytes: 0, totalBytes: 1, ratio: 0 });
      if (kind === 'start') funnelEvents.uploadStart(contentId);
      else funnelEvents.uploadResume(contentId);
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
        .then(() => {
          setPhase('done');
          funnelEvents.uploadComplete(contentId);
        })
        .catch((err: unknown) => {
          setPhase(err instanceof UploadAbortedError ? 'aborted' : 'failed');
        });
    },
    [contentId, media, uploadService, funnelEvents],
  );

  useEffect(() => {
    if (startedRef.current || !contentId || !media) return;
    startedRef.current = true;
    runUpload('start');
    // 언마운트 시 진행 중 업로드 취소 — retry로 갱신된 컨트롤러도 함께 정리한다
    return () => abortRef.current?.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 최초 1회 트리거 전용(runUpload는 최신 클로저를 참조)
  }, [contentId, media]);

  // 03§C-3 "업로드 실패 화면은 '다시 시도' 버튼 하나만 크게" — 재시도 = 재개(resume) 계측 트리거
  const retry = (): void => runUpload('resume');

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
            {/* 03§C-3 "업로드 실패 화면은 '다시 시도' 버튼 하나만 크게" — 기술 용어 없이 사용자 언어로 */}
            <Text style={styles.message}>인터넷이 잠깐 끊겼어요. 다시 눌러주세요.</Text>
            <Button label="다시 시도" onPress={retry} />
            <Button label="상세 보기" variant="secondary" onPress={goDetail} />
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
