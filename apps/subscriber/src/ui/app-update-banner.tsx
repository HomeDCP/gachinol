import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, touchTarget, typo } from '@gachinol/ui';
import { SW_UPDATE_NOTICE } from '../pwa/sw-update-policy';

interface AppUpdateBannerProps {
  /** 신 버전 대기 중 — false면 아무것도 렌더하지 않는다 */
  visible: boolean;
  /** 적용 진행 중(제어권 교체 대기) — 버튼을 다시 누르지 못하게 문구를 바꾼다 */
  applying?: boolean;
  onApply: () => void;
}

/**
 * "새 버전이 준비됐어요 — 새로고침" 알림 (02 §D-T5 2번).
 *
 * **자동으로 새로고침하지 않는다.** 이 배너가 존재하는 이유가 그것이다 — 사용자가 영상을 보는 중에
 * 페이지가 갈아엎히면 안 되므로, 갱신 적용은 이 버튼을 누른 순간에만 일어난다.
 *
 * 왜 구독자 앱에 토스트 호스트를 이식하지 않았나: 기자·관제의 `src/ui/feedback.tsx`는 3.2초 뒤 사라지는
 * 토스트 + 확인 다이얼로그 호스트다(인증 앱의 파괴적 동작 확인용). 갱신 알림은 **사라지면 안 되고**
 * (사용자가 3초 안에 읽고 누르지 못하면 그 배포는 그 세션에 영영 도달하지 않는다) 확인 다이얼로그도
 * 필요 없다. 그래서 200줄짜리 호스트를 복제하는 대신, 같은 디자인 토큰으로 **상주 배너**를 둔다.
 * 어르신 대상(03 §A-1)이라 버튼은 `touchTarget.min` 이상.
 *
 * react-native-web의 `Alert`가 빈 함수라(대장 #92) 알림을 Alert로 내면 웹에서 통째로 사라진다 —
 * 그래서 이 알림은 처음부터 렌더 트리 안의 컴포넌트다.
 */
export function AppUpdateBanner({
  visible,
  applying = false,
  onApply,
}: AppUpdateBannerProps): React.JSX.Element | null {
  if (!visible && !applying) return null;

  return (
    <View style={styles.wrap} accessibilityRole="alert">
      <View style={styles.card}>
        <Text style={styles.message}>{SW_UPDATE_NOTICE.message}</Text>
        <Pressable
          accessibilityRole="button"
          style={styles.action}
          disabled={applying}
          onPress={onApply}
        >
          <Text style={styles.actionLabel}>
            {applying ? '적용하는 중…' : SW_UPDATE_NOTICE.action}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    alignItems: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    maxWidth: 480,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.lg,
    paddingRight: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: 'rgba(17,17,20,0.94)',
  },
  message: { flexShrink: 1, fontSize: typo.body, color: '#FFFFFF' },
  action: {
    minHeight: touchTarget.min,
    minWidth: 96,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
  },
  actionLabel: { fontSize: typo.body, fontWeight: '700', color: '#FFFFFF' },
});
