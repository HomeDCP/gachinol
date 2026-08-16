import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useDraft } from '../../../../src/features/contents/draft-context';
import {
  UPLOAD_MODE_DESCRIPTION,
  UPLOAD_MODE_LABEL,
  UploadMode,
} from '../../../../src/features/contents/mode';
import { useUploadFunnelEvents } from '../../../../src/telemetry/use-upload-funnel-events';
import { Screen } from '../../../../src/ui/screen';
import { colors, radii, spacing, typo } from '../../../../src/ui/theme';

/**
 * ③-2 작성 방식 선택 (T-W2-34 — 대장 #123 · 정본 03 §C-4).
 *
 * ★ 이 화면이 자막 단계 **앞**에 있다는 것이 이 태스크의 전부다. 뒤에 있었을 때는 자막 화면이
 *   이미 검증을 강제한 뒤라 "간단 모드"가 아무것도 바꾸지 못했다(항등함수).
 *   - 간단 → 자막 화면을 **건너뛰고** 바로 분류로. 저장 시 `scenes: []`.
 *   - 정밀 → 기존 흐름 그대로 자막 화면으로.
 *
 * 선택은 되돌릴 수 있다(뒤로 와서 다시 고르면 된다). 그래서 확인 다이얼로그를 두지 않는다 —
 * 파괴적이지 않은 선택에 확인을 붙이면 정작 파괴적인 확인(이탈·취소)의 무게가 가벼워진다.
 */
export default function ModeScreen(): React.JSX.Element {
  const { mode, setMode } = useDraft();
  const funnelEvents = useUploadFunnelEvents();

  const choose = (next: UploadMode): void => {
    setMode(next);
    // 채택률 KPI(simpleAdoptionRate)의 유일한 발신처 — 화면 이동 전에 적재한다
    funnelEvents.modeSelected(next);
    router.push(
      next === UploadMode.Simple ? '/contents/new/classify' : '/contents/new/scenes',
    );
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <Text style={styles.lead}>
          자막을 지금 쓸지, 나중에 지사에서 채울지 고르세요. 나중에 바꿔도 됩니다.
        </Text>
        {[UploadMode.Simple, UploadMode.Precise].map((m) => (
          <Pressable
            key={m}
            accessibilityRole="button"
            style={[styles.card, mode === m && styles.cardSelected]}
            onPress={() => choose(m)}
          >
            <Text style={styles.cardTitle}>{UPLOAD_MODE_LABEL[m]}</Text>
            <Text style={styles.cardBody}>{UPLOAD_MODE_DESCRIPTION[m]}</Text>
            <Text style={styles.cardCta}>
              {m === UploadMode.Simple ? '바로 분류로 →' : '장면 기입으로 →'}
            </Text>
          </Pressable>
        ))}
        <Text style={styles.footnote}>
          간단으로 올린 영상은 목록의 &quot;자막 필요&quot; 칸에 모입니다. 지사에서 누구든 열어
          자막을 채울 수 있습니다.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.lg },
  lead: { fontSize: typo.body, color: colors.text, lineHeight: 22 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardSelected: { borderColor: colors.primary, borderWidth: 2 },
  cardTitle: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  cardBody: { fontSize: typo.body, color: colors.textMuted, lineHeight: 22 },
  cardCta: { fontSize: typo.caption, color: colors.primary, fontWeight: '700' },
  footnote: { fontSize: typo.caption, color: colors.textMuted, lineHeight: 18 },
});
