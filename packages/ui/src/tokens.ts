import { Platform } from 'react-native';

/**
 * @gachinol/ui — 디자인 토큰 레이어 1단계 (T-W1-01, 02 §E-1 "packages/ui 디자인 토큰 승격 1단계")
 *
 * 3앱(reporter·control-center·subscriber) 공용 계약. 후속 소비 전환 태스크(T-W1-02 구독자 ·
 * T-W2-05 기자 · T-W2-06 관제)가 각 앱의 `src/ui/theme.ts` import를 이 모듈로 **갈아끼우기만** 하면
 * 되도록, 기존 3개 theme.ts가 export하던 심볼의 합집합(colors·spacing·radii·typo·badgeTone·
 * BadgeToneName)을 그대로 커버한다 — reporter·control-center에만 있던 `colors.progress`·
 * `badgeTone.progress`도 여기서는 항상 포함한다(subscriber가 이 값을 그대로 얻어도 무해).
 *
 * `typo`(및 큰 자막 모드용 `typoLarge`)만 플랫폼 분기 대상이다(03 §A-1 "rem 전환의 실현 경로").
 * 웹 빌드는 packages/ui가 노출하는 CSS 커스텀 프로퍼티(./tokens.css, rem 단위)를 var() 참조로
 * 가리키고, 네이티브(iOS/Android) 빌드는 숫자 리터럴을 그대로 쓴다 — 조율자 판정(문언 긴장 해소):
 * 무변경 대상은 "단위 방식"(숫자 리터럴)이지 "값"이 아니므로, 네이티브도 03 §A-1이 명시 재정의한
 * 신 수치(본문 18 / 캡션 16 / 제목 22)를 따른다.
 *
 * RN `TextStyle.fontSize`의 선언 타입은 `number`뿐이다
 * (react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts:496 `fontSize?: number | undefined`).
 * 웹에서 돌려주는 CSS var() 참조 문자열은 `as unknown as number`로 캐스팅해 노출 타입을 number로
 * 유지한다 — 이렇게 해야 소비 측이 기존과 동일하게 `style={{ fontSize: typo.body }}`를 그대로 쓸 수
 * 있다(AC3 "갈아끼우기만" 요건). 이 캐스팅이 런타임에서 실제로 깨지지 않는 근거(react-native-web이
 * 문자열 스타일 값에 단위를 붙이지 않고 그대로 CSS로 통과시킴 — createReactDOMStyle/
 * normalizeValueWithProperty 실측 확인)는 T-W1-01 완료 보고의 "AC5 검증" 절 참조.
 */

/**
 * 웹에서는 CSS 커스텀 프로퍼티 var() 참조를, 네이티브에서는 숫자 리터럴을 반환한다.
 * 반환 타입은 항상 `number`로 선언한다(RN TextStyle.fontSize 계약 유지 — 위 파일 상단 설명 참조).
 */
function fontToken(cssVarName: string, nativeValue: number): number {
  return Platform.select<number>({
    web: `var(${cssVarName})` as unknown as number,
    default: nativeValue,
  });
}

export const colors = {
  bg: '#F7F7F8',
  card: '#FFFFFF',
  border: '#E5E5EA',
  text: '#111114',
  textMuted: '#6E6E76',
  primary: '#2563EB',
  danger: '#DC2626',
  warning: '#D97706',
  success: '#16A34A',
  info: '#4F46E5',
  progress: '#2563EB',
  neutral: '#8E8E93',
} as const;

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

export const radii = { sm: 6, md: 10, lg: 16 } as const;

/**
 * 인터랙티브 요소 최소 히트 영역 — 03 §A-1 "2.5.8 타깃 크기(최소)": 44×44pt(Apple HIG) /
 * 48×48dp(Material) 하한, 인접 타깃 간 여백 8px 이상. 이 값은 텍스트 확대(rem)와 무관한
 * 고정 치수라 웹/네이티브 분기가 필요 없다(font-* 만 rem 전환 대상, 03 §A-1).
 */
export const touchTarget = { min: 44, spacing: spacing.sm } as const;

/**
 * 03 §A-1 확정 수치: 본문 최소 18px(舊 16px) / 캡션(자막) 최소 16px(舊 13px 하향 폐기) /
 * 제목 22px 이상(舊 20px).
 */
export const typo = {
  title: fontToken('--gachinol-font-title', 22),
  body: fontToken('--gachinol-font-body', 18),
  caption: fontToken('--gachinol-font-caption', 16),
} as const;

/**
 * 큰 자막 모드 스케일 — 03 §A-1 "본문 22px·제목 26px" + §A-3(정본) "자막 22~24px" 중 **24px 채택**.
 * 채택 근거: §A-3은 큰 자막 모드를 "직사광선 시청 대비"(제주 어촌·농촌 실외 시청 비중 高) 목적으로
 * 명시하므로, 확정 범위(22~24px) 안에서 최대 가독성을 주는 상한값을 택한다. 또한 상한을 택해야
 * `typoLarge.caption`(24px)이 `typoLarge.body`(22px)와 값이 겹치지 않아 자막이 본문보다 더 크다는
 * 시각적 위계가 유지된다(둘 다 22px를 택하면 확대 모드에서 자막이 본문과 구분되지 않는다).
 *
 * ⚠️ 값 정의까지만 — 이 스케일로 전환하는 토글 UI·상태 관리·`localStorage` 저장은 별도 태스크
 * 소유이므로 여기서 구현하지 않는다(AC2). 후속 태스크는 플랫폼 무관하게 `typo` 대신 `typoLarge`를
 * 선택해 적용하면 된다(네이티브는 숫자 리터럴이 바로 다른 값이라 즉시 반영, 웹은 별도의
 * `--gachinol-font-*-large` CSS 변수를 참조하므로 기본 변수와 충돌하지 않는다 — tokens.css 참조).
 */
export const typoLarge = {
  title: fontToken('--gachinol-font-title-large', 26),
  body: fontToken('--gachinol-font-body-large', 22),
  caption: fontToken('--gachinol-font-caption-large', 24),
} as const;

/** tone → { bg(연한), fg(진한) } */
export const badgeTone = {
  neutral: { bg: '#EFEFF1', fg: '#5A5A63' },
  info: { bg: '#E9E8FB', fg: '#4F46E5' },
  progress: { bg: '#E2ECFD', fg: '#2563EB' },
  success: { bg: '#E3F4E8', fg: '#16A34A' },
  warning: { bg: '#FBEEDC', fg: '#D97706' },
  danger: { bg: '#FBE3E3', fg: '#DC2626' },
} as const;

export type BadgeToneName = keyof typeof badgeTone;
