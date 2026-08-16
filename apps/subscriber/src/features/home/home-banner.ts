/**
 * 홈화면 추가(PWA) 안내 배너 — "어르신 문구"(03 §A-5)의 판정 로직. **보강 3**: 저장소 읽기/쓰기까지
 * `KeyValueStorage`를 주입받는 얇은 함수로 빼서(`hasSeenHomeBanner`/`markHomeBannerSeen`·
 * `hasWatchedOnce`/`markWatchedOnce`·`evaluateAndRecordHomeBanner`) 목 스토리지로 테스트할 수
 * 있게 한다 — 舊 버전은 "노출되면 영구 기록"이 화면의 `useEffect` 안에만 있어 그 기록 호출을
 * 지워도(뮤테이션) 테스트가 전부 그린이었다(재방문 재노출 회귀를 못 잡음). 호출부
 * (`app/(tabs)/index.tsx`·`app/watch/[id].tsx`)는 이제 이 함수들을 부르기만 한다.
 */

/** localStorage 키 — 배너가 1회라도 노출됐음을 영구 기록(재방문 시 재노출 금지, 03 §A-5) */
export const HOME_BANNER_SEEN_KEY = 'gachinol.homeBanner.seen.v1';
/** localStorage 키 — 시청 화면(watch/[id])에 1회 이상 도달했음을 기록(배너 노출 트리거) */
export const HAS_WATCHED_ONCE_KEY = 'gachinol.hasWatchedOnce.v1';

/** `window.localStorage`가 구조적으로 만족하는 최소 계약 — 목 스토리지 주입용 */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function hasSeenHomeBanner(storage: KeyValueStorage): boolean {
  return storage.getItem(HOME_BANNER_SEEN_KEY) === '1';
}

export function markHomeBannerSeen(storage: KeyValueStorage): void {
  storage.setItem(HOME_BANNER_SEEN_KEY, '1');
}

export function hasWatchedOnce(storage: KeyValueStorage): boolean {
  return storage.getItem(HAS_WATCHED_ONCE_KEY) === '1';
}

export function markWatchedOnce(storage: KeyValueStorage): void {
  storage.setItem(HAS_WATCHED_ONCE_KEY, '1');
}

/** 카카오톡 인앱 웹뷰 감지 — UA에 'KAKAOTALK' 토큰 포함 여부(대소문자 무관, 실기기 확인된 표준 방식) */
export function isKakaoInAppBrowser(userAgent: string): boolean {
  return /kakaotalk/i.test(userAgent);
}

export type HomeAddPlatformHint = 'ios' | 'android' | 'other';

/** iOS/Android 분기 안내 문구 선택용 — "홈 화면에 추가" 조작 경로가 브라우저마다 다르다(03 §A-5) */
export function detectHomeAddPlatformHint(userAgent: string): HomeAddPlatformHint {
  const ua = userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return 'ios';
  if (/android/.test(ua)) return 'android';
  return 'other';
}

export type HomeBannerVariant = 'hidden' | 'open_in_browser' | 'add_to_home';

export interface HomeBannerInput {
  /** 네이티브(쉘) 빌드는 이미 "설치된 앱"이라 안내 자체가 무의미 — web에서만 노출 */
  isWeb: boolean;
  /** 강제 팝업 금지 — 영상 시청 화면에 1회 이상 도달한 뒤에만 제안(03 §A-5) */
  hasWatchedOnce: boolean;
  /** 이미 1회 노출된 적 있으면 재방문 시 다시 띄우지 않는다(거절/무시 = 영구 숨김) */
  alreadySeen: boolean;
  isKakaoInApp: boolean;
}

/**
 * 배너 상태 판정 — 카카오 인앱 웹뷰에서는 "홈 화면에 추가"가 동작하지 않으므로(공유 시트 부재)
 * 먼저 "다른 브라우저로 열기"를 제시하고, 그 경로로 넘어간 뒤(=더 이상 카카오 웹뷰가 아닐 때)에만
 * 홈화면 추가 배너를 노출한다(03 §A-5 분기 규칙 그대로).
 */
export function resolveHomeBannerVariant(input: HomeBannerInput): HomeBannerVariant {
  if (!input.isWeb) return 'hidden';
  if (!input.hasWatchedOnce) return 'hidden';
  if (input.alreadySeen) return 'hidden';
  return input.isKakaoInApp ? 'open_in_browser' : 'add_to_home';
}

/**
 * 판정 + 기록을 한 번에 — 노출되는 순간(variant !== 'hidden') "1회성" 영구 기록까지 이 함수가
 * 책임진다(보강 3). 화면의 `useEffect`는 이 함수 하나만 부르면 되고, 기록 누락은 여기 테스트가 잡는다.
 */
export function evaluateAndRecordHomeBanner(
  storage: KeyValueStorage,
  userAgent: string,
  isWeb: boolean,
): { variant: HomeBannerVariant; platformHint: HomeAddPlatformHint } {
  const variant = resolveHomeBannerVariant({
    isWeb,
    hasWatchedOnce: hasWatchedOnce(storage),
    alreadySeen: hasSeenHomeBanner(storage),
    isKakaoInApp: isKakaoInAppBrowser(userAgent),
  });
  if (variant !== 'hidden') markHomeBannerSeen(storage);
  return { variant, platformHint: detectHomeAddPlatformHint(userAgent) };
}

/**
 * 카카오톡 인앱 웹뷰 탈출 링크 — 카카오 자체 스킴(`kakaotalk://web/openExternal`)으로 시스템
 * 기본 브라우저에서 현재 URL을 다시 연다. 이 스킴은 카카오톡 앱 안에서만 유효해 카카오 웹뷰
 * 감지 시에만 사용한다.
 */
export function buildKakaoExternalOpenUrl(currentUrl: string): string {
  return `kakaotalk://web/openExternal?url=${encodeURIComponent(currentUrl)}`;
}
