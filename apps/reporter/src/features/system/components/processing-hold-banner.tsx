import { StyleSheet, Text, View } from 'react-native';
import type { ProcessingState } from '@gachinol/shared';
import { badgeTone, colors, radii, spacing, typo } from '../../../ui/theme';
import { formatHoldElapsed, holdBannerContent } from '../processing-hold';

interface ProcessingHoldBannerProps {
  state: ProcessingState;
}

/**
 * 처리 대기 안내 — 백엔드가 DCP 파이프라인과 호스트를 공유할 때, DCP 작업 중에는
 * 영상 처리 큐가 멈춘다. "업로드는 됐는데 왜 진행이 안 되지?"에 답하는 배너.
 *
 * 실패가 아니라 **대기**이므로 danger가 아닌 warning 톤을 쓴다(사용자가 조치할 것이 없다).
 */
export function ProcessingHoldBanner({ state }: ProcessingHoldBannerProps): React.JSX.Element {
  const { title, detail } = holdBannerContent(state);
  const elapsed = formatHoldElapsed(state.dcp?.since ?? null);
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <View style={styles.headerRow}>
        <Text style={styles.title}>{title}</Text>
        {elapsed ? <Text style={styles.elapsed}>{elapsed}</Text> : null}
      </View>
      <Text style={styles.detail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: badgeTone.warning.bg,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.warning,
    padding: spacing.md,
    gap: spacing.xs,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: typo.caption, fontWeight: '700', color: badgeTone.warning.fg },
  elapsed: { fontSize: typo.caption, color: badgeTone.warning.fg },
  detail: { fontSize: typo.caption, color: colors.text, lineHeight: 18 },
});
