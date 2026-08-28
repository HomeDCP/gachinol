import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Stack } from 'expo-router';
import { useMutation } from '@tanstack/react-query';
import { issueResidentLink } from '../../../src/api/resident-links';
import { userMessageForError } from '../../../src/api/errors';
import { useApiClient } from '../../../src/auth/auth-context';
import {
  buildResidentUploadUrl,
  copyResidentLinkText,
  formatExpiresAt,
  residentUploadPath,
  residentUploadUrlContext,
} from '../../../src/features/resident-uploads/issue';
import { formatBytes } from '../../../src/features/resident-uploads/media';
import { Button } from '../../../src/ui/button';
import { Screen } from '../../../src/ui/screen';
import { showToast } from '../../../src/ui/toast';
import { badgeTone, colors, radii, spacing, typo } from '../../../src/ui/theme';

/**
 * ② 주민 링크 발급(T-W2-35, 대장 #147) — 03 §C-5 주민 공급 경로의 발급 측.
 *
 * · 제약치(유효기간·건수·용량)는 화면에 박지 않는다 — 발급 응답의 서버 값만 렌더한다(E2 명문.
 *   03 §C-5 수치가 바뀌어도 이 화면은 수정 대상이 아니다).
 * · 토큰 원문은 발급 응답에서 1회만 온다(서버는 해시만 보관) — 화면 이탈 후 재조회가 불가능하므로
 *   결과 카드 최상단에 "지금만 복사" 경고를 둔다. 발급 이력 목록이 없는 것도 같은 이유다(만들 수 없다).
 */
export default function IssueResidentLinkScreen(): React.JSX.Element {
  const client = useApiClient();
  const issue = useMutation({
    mutationFn: () => issueResidentLink(client),
    onError: () => showToast('링크 발급에 실패했습니다'),
  });

  const issued = issue.data ?? null;
  const shareUrl = issued ? buildResidentUploadUrl(issued.token, residentUploadUrlContext()) : null;
  const shareText = issued ? (shareUrl ?? residentUploadPath(issued.token)) : null;

  const copy = async (): Promise<void> => {
    if (!shareText) return;
    const ok = await copyResidentLinkText(shareText);
    showToast(ok ? '링크를 복사했습니다' : '복사에 실패했습니다 — 링크를 길게 눌러 직접 복사해주세요');
  };

  return (
    <Screen>
      <Stack.Screen options={{ title: '주민 링크 발급' }} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          주민(이장·부녀회장·어촌계장 등)에게 전달할 임시 업로드 링크를 만듭니다. 링크를 받은
          주민은 로그인 없이 촬영 영상을 올릴 수 있고, 올라온 영상은 검수를 거쳐야 정식 파이프라인에
          들어갑니다.
        </Text>

        <Button
          label="새 링크 발급"
          onPress={() => issue.mutate()}
          loading={issue.isPending}
        />

        {issue.isError ? (
          <Text style={styles.errorText}>{userMessageForError(issue.error)}</Text>
        ) : null}

        {issued ? (
          <View style={styles.resultCard}>
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                이 링크는 지금만 복사할 수 있습니다 — 화면을 벗어나면 다시 볼 수 없습니다(분실 시
                재발급).
              </Text>
            </View>

            <Text style={styles.resultTitle}>{issued.stationName} 주민 업로드 링크</Text>

            <Text style={styles.linkText} selectable>
              {shareUrl ?? residentUploadPath(issued.token)}
            </Text>
            {shareUrl == null ? (
              <Text style={styles.linkFallbackHint}>
                구독자 웹 주소가 설정되지 않아 전체 주소를 만들 수 없습니다. 위 경로를 구독자 웹
                주소 뒤에 붙여 전달하고, 관리자에게 EXPO_PUBLIC_SUBSCRIBER_WEB_URL 설정을
                요청해주세요.
              </Text>
            ) : null}

            <Text style={styles.metaText}>만료: {formatExpiresAt(issued.expiresAt)}</Text>
            <Text style={styles.metaText}>
              업로드: 최대 {issued.maxUploads}건(잔여 {issued.remainingUploads}건) · 파일당 최대{' '}
              {formatBytes(issued.maxFileSizeBytes)}
            </Text>

            <Button label="링크 복사" variant="secondary" onPress={() => void copy()} />
          </View>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.lg, gap: spacing.lg },
  intro: { fontSize: typo.body, color: colors.text, lineHeight: 24 },
  errorText: { fontSize: typo.caption, color: colors.danger },
  resultCard: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.md,
  },
  warningBox: {
    backgroundColor: badgeTone.warning.bg,
    borderRadius: radii.sm,
    padding: spacing.md,
  },
  warningText: { fontSize: typo.caption, color: colors.text, fontWeight: '600', lineHeight: 20 },
  resultTitle: { fontSize: typo.body, fontWeight: '600', color: colors.text },
  linkText: { fontSize: typo.body, color: colors.primary },
  linkFallbackHint: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 20 },
  metaText: { fontSize: typo.caption, color: colors.textMuted },
});
