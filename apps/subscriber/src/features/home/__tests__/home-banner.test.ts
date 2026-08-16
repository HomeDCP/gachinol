import {
  buildKakaoExternalOpenUrl,
  detectHomeAddPlatformHint,
  evaluateAndRecordHomeBanner,
  hasSeenHomeBanner,
  hasWatchedOnce,
  HOME_BANNER_SEEN_KEY,
  isKakaoInAppBrowser,
  markHomeBannerSeen,
  markWatchedOnce,
  resolveHomeBannerVariant,
  type KeyValueStorage,
} from '../home-banner';

/** `window.localStorage`를 흉내 낸 목 스토리지(보강 3) — 실 브라우저 없이 get/set 왕복을 검증 */
function createMockStorage(): KeyValueStorage {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value);
    },
  };
}

const KAKAO_UA =
  'Mozilla/5.0 (Linux; Android 13; SM-S911N) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.0.0 Mobile Safari/537.36 KAKAOTALK 10.9.5';
const IOS_SAFARI_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_CHROME_UA =
  'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';
const DESKTOP_CHROME_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

describe('isKakaoInAppBrowser', () => {
  test('KAKAOTALK 토큰 포함 UA → true', () => {
    expect(isKakaoInAppBrowser(KAKAO_UA)).toBe(true);
  });

  test('일반 브라우저 UA → false', () => {
    expect(isKakaoInAppBrowser(IOS_SAFARI_UA)).toBe(false);
    expect(isKakaoInAppBrowser(ANDROID_CHROME_UA)).toBe(false);
    expect(isKakaoInAppBrowser(DESKTOP_CHROME_UA)).toBe(false);
  });

  test('대소문자 무관', () => {
    expect(isKakaoInAppBrowser('...kakaotalk/10.0...')).toBe(true);
    expect(isKakaoInAppBrowser('...KakaoTalk/10.0...')).toBe(true);
  });
});

describe('detectHomeAddPlatformHint', () => {
  test('iOS 계열(iPhone/iPad/iPod) → ios', () => {
    expect(detectHomeAddPlatformHint(IOS_SAFARI_UA)).toBe('ios');
  });

  test('Android → android', () => {
    expect(detectHomeAddPlatformHint(ANDROID_CHROME_UA)).toBe('android');
  });

  test('데스크톱 등 그 외 → other', () => {
    expect(detectHomeAddPlatformHint(DESKTOP_CHROME_UA)).toBe('other');
  });
});

describe('resolveHomeBannerVariant', () => {
  const base = { isWeb: true, hasWatchedOnce: true, alreadySeen: false, isKakaoInApp: false };

  test('네이티브(쉘) 빌드는 항상 hidden', () => {
    expect(resolveHomeBannerVariant({ ...base, isWeb: false })).toBe('hidden');
  });

  test('영상 시청 전(강제 팝업 금지)에는 hidden', () => {
    expect(resolveHomeBannerVariant({ ...base, hasWatchedOnce: false })).toBe('hidden');
  });

  test('이미 1회 노출된 적 있으면 hidden(재방문 시 재노출 금지)', () => {
    expect(resolveHomeBannerVariant({ ...base, alreadySeen: true })).toBe('hidden');
  });

  test('일반 브라우저 + 조건 충족 → add_to_home', () => {
    expect(resolveHomeBannerVariant(base)).toBe('add_to_home');
  });

  test('카카오 인앱 웹뷰 + 조건 충족 → open_in_browser(홈화면 추가보다 우선)', () => {
    expect(resolveHomeBannerVariant({ ...base, isKakaoInApp: true })).toBe('open_in_browser');
  });
});

describe('buildKakaoExternalOpenUrl', () => {
  test('kakaotalk://web/openExternal 스킴 + URL 인코딩', () => {
    const url = buildKakaoExternalOpenUrl('https://gachinol.example/watch/123?ref=kakao&x=1');
    expect(url).toBe(
      'kakaotalk://web/openExternal?url=https%3A%2F%2Fgachinol.example%2Fwatch%2F123%3Fref%3Dkakao%26x%3D1',
    );
  });
});

describe('저장소 헬퍼(보강 3) — hasSeenHomeBanner/markHomeBannerSeen', () => {
  test('초기 상태는 false, 기록 후 true', () => {
    const storage = createMockStorage();
    expect(hasSeenHomeBanner(storage)).toBe(false);
    markHomeBannerSeen(storage);
    expect(hasSeenHomeBanner(storage)).toBe(true);
  });

  test('실제 저장 키는 HOME_BANNER_SEEN_KEY', () => {
    const storage = createMockStorage();
    markHomeBannerSeen(storage);
    expect(storage.getItem(HOME_BANNER_SEEN_KEY)).toBe('1');
  });
});

describe('저장소 헬퍼(보강 3) — hasWatchedOnce/markWatchedOnce', () => {
  test('초기 상태는 false, 기록 후 true', () => {
    const storage = createMockStorage();
    expect(hasWatchedOnce(storage)).toBe(false);
    markWatchedOnce(storage);
    expect(hasWatchedOnce(storage)).toBe(true);
  });
});

describe('evaluateAndRecordHomeBanner — 판정+기록 통합(보강 3, 재방문 재노출 회귀 방어)', () => {
  test('시청 이력 있는 웹 방문자: 최초 호출 = add_to_home, 같은 스토리지로 재호출 = hidden', () => {
    const storage = createMockStorage();
    markWatchedOnce(storage);

    const first = evaluateAndRecordHomeBanner(storage, DESKTOP_CHROME_UA, true);
    expect(first.variant).toBe('add_to_home');

    // markHomeBannerSeen 호출이 뮤테이션으로 지워지면 이 두 번째 호출도 add_to_home으로
    // 남아 아래 단언이 실패한다 — 검증자가 실제로 적발한 뮤테이션의 회귀 방어.
    const second = evaluateAndRecordHomeBanner(storage, DESKTOP_CHROME_UA, true);
    expect(second.variant).toBe('hidden');
  });

  test('시청 이력이 아직 없으면 hidden이며, 기록도 남기지 않는다(강제 팝업 금지 원칙 유지)', () => {
    const storage = createMockStorage();
    const result = evaluateAndRecordHomeBanner(storage, DESKTOP_CHROME_UA, true);
    expect(result.variant).toBe('hidden');
    expect(hasSeenHomeBanner(storage)).toBe(false);
  });

  test('카카오 인앱 웹뷰면 platformHint와 무관하게 open_in_browser', () => {
    const storage = createMockStorage();
    markWatchedOnce(storage);
    const result = evaluateAndRecordHomeBanner(storage, KAKAO_UA, true);
    expect(result.variant).toBe('open_in_browser');
  });

  test('platformHint가 UA에서 올바르게 파생된다', () => {
    const storage = createMockStorage();
    markWatchedOnce(storage);
    expect(evaluateAndRecordHomeBanner(storage, IOS_SAFARI_UA, true).platformHint).toBe('ios');
  });
});
