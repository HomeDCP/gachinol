import { useEffect, useRef, useState } from 'react';
import { Linking, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useNavigation } from 'expo-router';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useDraft } from '../../../../src/features/contents/draft-context';
import { Button } from '../../../../src/ui/button';
import { Screen } from '../../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../../src/ui/theme';
import { showToast } from '../../../../src/ui/toast';

/** URI 마지막 세그먼트를 파일명으로 (없으면 기본값) */
function fileNameFromUri(uri: string): string {
  const last = uri.split('/').pop();
  return last && last.length > 0 ? last : 'video.mp4';
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
        setMedia({
          uri: video.uri,
          fileName: fileNameFromUri(video.uri),
          mimeType: 'video/mp4',
          sizeBytes: 0, // recordAsync는 크기를 주지 않음 — Mock 업로드라 무해
        });
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
          현장 영상을 촬영하거나 촬영해 둔 영상을 선택하세요. 영상 없이 자막·분류만 먼저 작성할 수도
          있습니다.
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
          <Button label="카메라로 촬영" onPress={() => void openCamera()} />
          <Button
            label="갤러리에서 선택"
            variant="secondary"
            onPress={() => void pickFromLibrary()}
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
