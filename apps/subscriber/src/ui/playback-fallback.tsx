import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, touchTarget, typo } from '@gachinol/ui';

export interface PlaybackFallbackAction {
  label: string;
  onPress: () => void;
}

interface PlaybackFallbackProps {
  message: string;
  /**
   * 렌더되는 버튼은 전부 눌리는 상태여야 한다(보강 1) — 목적지가 없는 버튼을 흐리게 보여주고
   * 못 누르게 하지 않는다. 호출부가 `resolveLiveFallbackButtons`/`resolveVodFallbackButtons`로
   * "실제로 동작 가능한" 버튼만 골라 넘긴다(최소 1개는 항상 "다시 시도"로 보장됨).
   */
  actions: readonly PlaybackFallbackAction[];
}

/**
 * 재생 실패 시 어르신 화면(03 §A-6 "재생 실패 시 어르신 화면") — 라이브·VOD 공통 폴백. 기술 용어
 * 금지 톤 유지, 손가락 폭 이상 큰 버튼(touchTarget.min). 재생 영역과 동일한 16:9 검은 박스 안에
 * 렌더해 레이아웃 점프 없이 플레이어 자리를 대신한다.
 */
export function PlaybackFallback({ message, actions }: PlaybackFallbackProps): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.message}>{message}</Text>
      <View style={styles.actions}>
        {actions.map((action, index) => (
          <Pressable
            key={action.label}
            style={[styles.button, index === 0 ? styles.primary : styles.secondary]}
            onPress={action.onPress}
          >
            <Text style={index === 0 ? styles.primaryLabel : styles.secondaryLabel}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#000000',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.lg,
  },
  message: { color: '#FFFFFF', fontSize: typo.body, textAlign: 'center' },
  actions: { width: '100%', gap: spacing.sm },
  button: {
    minHeight: touchTarget.min,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
  },
  primary: { backgroundColor: colors.primary },
  primaryLabel: { color: '#FFFFFF', fontSize: typo.body, fontWeight: '700' },
  secondary: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: colors.border },
  secondaryLabel: { color: colors.text, fontSize: typo.body, fontWeight: '700' },
});

// ─────────────────────────────────────────────────────────────────────────
// 보강 1 — 버튼 가용성·문구 판정(순수 함수, 단위 테스트 대상). 화면(app/live/[id].tsx·
// app/watch/[id].tsx)은 env에서 읽은 값을 이 함수들에 넘기고 결과를 그대로 렌더하기만 한다.
// ─────────────────────────────────────────────────────────────────────────

export interface FallbackButtonSpec {
  key: 'retry' | 'youtube' | 'tel';
  label: string;
}

/**
 * 라이브 폴백 버튼 목록 — "다시 시도"는 env 설정과 무관하게 항상 포함해 **최소 1개는 항상
 * 동작**하게 한다(qa-verifier 실측 결함: env 미설정 기본 배포에서 舊 2버튼이 둘 다
 * `disabled`라 아무것도 못 눌렀다). 유튜브·전화 목적지가 실제로 설정된 경우에만 추가 —
 * 설정 안 된 버튼은 흐린 채로도 렌더하지 않는다(가짜 목적지를 지어내지 않는다는 원칙과
 * "화면이 스스로 무력화되면 안 된다"는 원칙을 함께 지키는 유일한 조합).
 */
export function resolveLiveFallbackButtons(input: {
  youtubeUrl: string | null;
  supportTelHref: string | null;
}): readonly FallbackButtonSpec[] {
  const buttons: FallbackButtonSpec[] = [{ key: 'retry', label: '다시 시도' }];
  if (input.youtubeUrl) buttons.push({ key: 'youtube', label: '유튜브에서 보기' });
  if (input.supportTelHref) buttons.push({ key: 'tel', label: '전화로 문의하기' });
  return buttons;
}

/** VOD 폴백 버튼 목록 — "다시 시도"는 항상, "전화로 문의하기"는 설정된 경우에만(위와 동형 원칙) */
export function resolveVodFallbackButtons(input: {
  supportTelHref: string | null;
}): readonly FallbackButtonSpec[] {
  const buttons: FallbackButtonSpec[] = [{ key: 'retry', label: '다시 시도' }];
  if (input.supportTelHref) buttons.push({ key: 'tel', label: '전화로 문의하기' });
  return buttons;
}

/**
 * 버튼 수에 맞춰 안내 문구를 조정한다 — "아래 버튼을 눌러 다른 곳에서 봐 주세요"가 버튼이
 * "다시 시도" 1개뿐인 화면에서도 그대로 뜨면 문구와 화면 상태가 어긋난다(보강 1 핵심).
 */
export function resolvePlaybackFallbackMessage(buttonCount: number): string {
  return buttonCount <= 1
    ? '지금은 화면이 잘 안 나오고 있어요. 아래 버튼을 눌러 다시 시도해 주세요.'
    : '지금은 화면이 잘 안 나오고 있어요. 아래 버튼을 눌러 다시 시도하거나 다른 곳에서 봐 주세요.';
}
