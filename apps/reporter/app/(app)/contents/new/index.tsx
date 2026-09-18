import { useEffect, useRef, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import {
  GhostMediaError,
  captureVideoViaImagePicker,
  fileNameFromUri,
  toCapturedRecordedVideo,
} from '../../../../src/capture/video-capture';
import { useDraft } from '../../../../src/features/contents/draft-context';
import { Button } from '../../../../src/ui/button';
import { Screen } from '../../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../../src/ui/theme';
import { showToast } from '../../../../src/ui/toast';

/** 촬영/녹화 실패(유령 미디어 방어 포함)의 사용자 안내 — 방어가 준 메시지는 그대로, 그 외는 일반 문구 */
function captureFailureMessage(err: unknown): string {
  return err instanceof GhostMediaError ? err.message : '촬영에 실패했습니다 — 다시 시도해주세요';
}

/** ③-1 촬영/갤러리 — media는 세션 메모리에만 (재시작 시 유실: open question) */
export default function CaptureScreen(): React.JSX.Element {
  const { media, setMedia } = useDraft();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [micPermission, requestMicPermission] = useMicrophonePermissions();
  const [cameraOpen, setCameraOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const navigation = useNavigation();
  // beforeRemove 동기 판독용 미러 — 녹화 시작/종료와 같은 흐름에서 즉시 갱신
  const recordingRef = useRef(false);

  // 녹화 중 이탈 차단 — recording은 isDirty에 반영되지 않고(media는 recordAsync 완료 후 set)
  // 하드웨어 백·iOS 스와이프는 화면 내 '닫기' disabled와 달리 무방비였다.
  // 언마운트되면 recordAsync 결과가 버려져 촬영본이 통째로 유실된다.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (!recordingRef.current) return;
      e.preventDefault();
      // 확인 버튼만 있는 알림이라 토스트로 충분하다(웹에서 Alert는 no-op — ui/feedback 주석 참조)
      showToast('녹화 중입니다 — 나가려면 먼저 녹화를 중지해 주세요');
    });
    return unsubscribe;
  }, [navigation]);

  const ensurePermissions = async (): Promise<boolean> => {
    const cam = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    const mic = micPermission?.granted ? micPermission : await requestMicPermission();
    if (cam.granted && mic.granted) return true;
    showToast('카메라·마이크 권한이 필요합니다. 설정에서 허용해 주세요.');
    if ((!cam.granted && !cam.canAskAgain) || (!mic.granted && !mic.canAskAgain)) {
      void Linking.openSettings();
    }
    return false;
  };

  const openCamera = async (): Promise<void> => {
    if (Platform.OS === 'web') {
      // expo-camera의 CameraView.recordAsync()는 웹에서 { uri: '' }만 준다(동작하지 않는다 —
      // src/capture/video-capture.ts 헤더 주석 상세). 임베디드 프리뷰(cameraOpen=true 분기)를
      // 열어봐야 막다른 길이라, 곧장 실제로 동작하는 경로(ImagePicker의 <input capture> 기반
      // launchCameraAsync)로 보낸다. 네이티브는 아래 else 경로(기존 임베디드 녹화 UX) 그대로.
      try {
        const captured = await captureVideoViaImagePicker(ImagePicker);
        if (captured) setMedia(captured);
      } catch (err) {
        showToast(captureFailureMessage(err));
      }
      return;
    }
    if (await ensurePermissions()) setCameraOpen(true);
  };

  const toggleRecording = async (): Promise<void> => {
    const camera = cameraRef.current;
    if (!camera) return;
    if (recording) {
      camera.stopRecording();
      return;
    }
    recordingRef.current = true;
    setRecording(true);
    try {
      const video = await camera.recordAsync();
      if (video) {
        try {
          // recordAsync는 크기를 주지 않는다 — 서버 zod가 sizeBytes positive를 요구해 0은
          // upload-url(①)에서 400이므로 getInfoAsync로 직후 실측한다(구 "Mock이라 무해" 주석은
          // 실업로드 전환 후 거짓이 됐다 — toCapturedRecordedVideo가 실측 + 유령 미디어 방어를 겸한다).
          setMedia(await toCapturedRecordedVideo(FileSystem, video));
        } catch (err) {
          showToast(captureFailureMessage(err));
        }
      }
      setCameraOpen(false);
    } finally {
      recordingRef.current = false;
      setRecording(false);
    }
  };

  const pickFromLibrary = async (): Promise<void> => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'] });
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setMedia({
      uri: asset.uri,
      fileName: asset.fileName ?? fileNameFromUri(asset.uri),
      mimeType: asset.mimeType ?? 'video/mp4',
      sizeBytes: asset.fileSize ?? 0,
      ...(asset.duration != null ? { durationSec: Math.round(asset.duration / 1000) } : {}),
    });
  };

  if (cameraOpen) {
    return (
      <View style={styles.cameraContainer}>
        <CameraView ref={cameraRef} style={styles.camera} mode="video" />
        <View style={styles.cameraControls}>
          <Button
            label={recording ? '녹화 중지' : '녹화 시작'}
            variant={recording ? 'destructive' : 'primary'}
            onPress={() => void toggleRecording()}
          />
          <Button
            label="닫기"
            variant="secondary"
            disabled={recording}
            onPress={() => setCameraOpen(false)}
          />
        </View>
      </View>
    );
  }

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.description}>
          또렷한 화질로 내보내려면 휴대폰 기본 카메라 앱으로 먼저 찍고, 아래에서 그 영상을
          올려주세요. 영상 없이 자막·분류만 먼저 작성할 수도 있습니다.
        </Text>
        {media ? (
          <View style={styles.mediaCard}>
            <Text style={styles.mediaTitle}>선택된 영상</Text>
            <Text style={styles.mediaMeta}>{media.fileName}</Text>
            {media.durationSec != null ? (
              <Text style={styles.mediaMeta}>{media.durationSec}초</Text>
            ) : null}
            <Button label="영상 제거" variant="secondary" onPress={() => setMedia(null)} />
          </View>
        ) : null}
        <View style={styles.buttons}>
          {/* 갤러리 경로가 주 버튼이다 — WebKit 미해결 버그(bugs.webkit.org #197216)로 이 화면의
              카메라 촬영은 저화질(360×480)만 만든다. 앱이 고칠 수 없는 문제라 화면 순서로
              기자를 고화질 경로로 먼저 안내한다(대장 #230). */}
          <Button
            label="휴대폰 카메라로 찍은 영상 올리기"
            onPress={() => void pickFromLibrary()}
          />
          <Button
            label="여기서 바로 촬영 (화질 낮음)"
            variant="secondary"
            onPress={() => void openCamera()}
          />
          {/* 다음 단계는 자막이 아니라 **작성 방식 선택**이다 (T-W2-34, 대장 #123) */}
          <Button
            label={media ? '다음 — 작성 방식 선택' : '영상 없이 계속'}
            variant={media ? 'primary' : 'secondary'}
            onPress={() => router.push('/contents/new/mode')}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  description: { fontSize: typo.body, color: colors.textMuted, lineHeight: 22 },
  mediaCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  mediaTitle: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  mediaMeta: { fontSize: typo.caption, color: colors.textMuted },
  buttons: { gap: spacing.md },
  cameraContainer: { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },
  cameraControls: { padding: spacing.lg, gap: spacing.md, backgroundColor: '#000' },
});
