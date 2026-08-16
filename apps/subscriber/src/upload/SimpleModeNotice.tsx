import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, spacing, typo } from '@gachinol/ui';
import {
  CONTACT_PURPOSE_NOTICE,
  LEGAL_CONSENT_TEXT,
  REVIEW_GATE_NOTICE,
  SIMPLE_MODE_NOTICE,
} from './gate';

/* ══════════════════════════════════════════════════════════════════════════
 * 간단 모드 강제 노출 안내 (T-W2-09 — E2 §C 지정 산출물, 정본 03 §C-5)
 *
 * ⚠️ 파일명이 이 리포의 kebab-case 관례와 다른 것은 의도적이다 — E2 §C가 산출물 경로를
 *    `apps/subscriber/src/upload/SimpleModeNotice.tsx`로 **문자 그대로 지정**했고, 계획 문서의
 *    파일 소유권 열은 태스크 간 배타 판정의 근거라 임의로 바꾸지 않는다.
 *
 * ── 이 컴포넌트가 지키는 두 문장 ────────────────────────────────────────────
 * ① **검수 게이트**(`REVIEW_GATE_NOTICE`) — 03 §C-5 "반드시 지사 담당자 검수를 거쳐야 정식
 *    파이프라인에 진입". 이 문장이 사라지면 무인증 업로더가 "올리면 바로 방송"으로 오해한다.
 * ② **간단 모드**(`SIMPLE_MODE_NOTICE`) — 제목·분류·자막을 주민에게 요구하지 않는다. 서버도 그
 *    입력을 **받는 필드 자체가 없어**(`zResidentUploadRequest`) 축소 UI가 우회 불가능하다.
 *
 * 문구의 원천은 전부 `gate.ts`의 상수다(화면·컴포넌트에 리터럴 재타이핑 금지 — 한쪽만 고쳐지는
 * 것을 막고, 테스트가 상수를 기준으로 고정할 수 있게 한다).
 *
 * 기자 앱 간단 모드(T-W2-34 `features/contents/mode.ts`)와의 정합: 그쪽은 `simple`/`precise`를
 * **고를 수 있는** 위저드 분기이고 간단 모드에서 자막 단계를 건너뛴다(`scenes: []`). 주민 화면은
 * 그 선택지 자체가 없는 **강제 간단 모드**이며, 결과물의 모양(자막 없음)은 동일하다. 다만 기자 앱은
 * "자막은 지사 담당자가 나중에 채웁니다"라고 약속할 수 있고(`PATCH /:id/captions`가 실재) 주민
 * 화면은 제목·분류까지는 약속하지 않는다 — 그 경로가 서버에 없기 때문이다(대장 #136, gate.ts 주석).
 * ══════════════════════════════════════════════════════════════════════════ */

export function SimpleModeNotice(): React.JSX.Element {
  return (
    <View style={styles.card} accessibilityRole="summary">
      <Text style={styles.heading}>올리기 전에 알아두실 점</Text>

      <NoticeLine text={REVIEW_GATE_NOTICE} emphasis />
      <NoticeLine text={SIMPLE_MODE_NOTICE} />
      <NoticeLine text={CONTACT_PURPOSE_NOTICE} />

      {/* 07 §3-15 이용허락 문구 자리 — 외부 법률자문 확정 전까지 `LEGAL_CONSENT_TEXT`가 null이라
          아무것도 렌더하지 않는다(문구 없는 동의를 받지 않는다). 근거는 gate.ts 상수 주석. */}
      {LEGAL_CONSENT_TEXT ? <NoticeLine text={LEGAL_CONSENT_TEXT} /> : null}
    </View>
  );
}

function NoticeLine({ text, emphasis }: { text: string; emphasis?: boolean }): React.JSX.Element {
  return (
    <View style={styles.line}>
      <Text style={styles.bullet}>·</Text>
      <Text style={[styles.text, emphasis ? styles.emphasis : null]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  heading: { fontSize: typo.body, fontWeight: '700', color: colors.text },
  line: { flexDirection: 'row', gap: spacing.sm },
  bullet: { fontSize: typo.body, color: colors.textMuted },
  // 어르신 우선(03 §A) — 본문 18px 토큰 그대로 + 넉넉한 줄간격
  text: { flex: 1, fontSize: typo.body, lineHeight: 28, color: colors.text },
  emphasis: { fontWeight: '700', color: colors.warning },
});
