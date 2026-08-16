import { render } from '@testing-library/react-native';

/**
 * 정적 방송 편성표 화면(`app/schedule.tsx`) 렌더 테스트 — T-W1-10.
 *
 * ── 이 파일이 고정하는 핵심 불변식 ────────────────────────────────────────────
 * ① **네트워크 호출 0**. 04 §B④가 이 페이지를 발주한 이유가 "제온(api) 다운 시 라이브 신규
 *    진입이 0이 되는 것"의 완화이므로, 화면이 api를 부르면 필요한 순간에 같이 죽어 존재
 *    이유가 사라진다. `fetch`·`XMLHttpRequest`를 폭파해 두고도 화면 전체가 렌더되는 것으로
 *    증명한다 — 이것이 `app/(tabs)/live.tsx`(GET /v1/live/sessions 의존)와의 **결정적 차이**다.
 * ② 게시된 HLS URL이 있을 때만 재생 영역이 뜬다(가짜 재생 버튼 금지).
 * ③ 요일 판정이 제주(KST) 기준이다.
 *
 * 테스트를 `src/**\/__tests__/`에 두는 이유: expo-router의 require.context가 `app/` 하위를
 * 전부 라우트로 흡수해 프로덕션 번들이 오염된다(watch-screen-contact.render.test.tsx 선례).
 */

// hls.js는 jsdom에서 MediaSource가 없어 죽는다. 재생 자체는 이 태스크의 범위가 아니고
// "재생 영역이 뜨는가/안 뜨는가"만 판정하면 되므로 어댑터를 표식 컴포넌트로 대체한다.
jest.mock('../../live/hls-video', () => {
  const { Text } = require('react-native');
  return {
    HlsVideo: ({ sourceUrl }: { sourceUrl: string }) => <Text>{`PLAYER:${sourceUrl}`}</Text>,
  };
});

import ScheduleScreen from '../../../app/schedule';

const VALID_HLS = 'https://customer-abc123.cloudflarestream.com/deadbeef/manifest/video.m3u8';

/** 이 순간을 "지금"으로 고정 — 2026-08-19T03:00Z = KST 2026-08-19(수) 12:00 */
const WED_KST = new Date('2026-08-19T03:00:00.000Z');
/** 2026-08-15T15:00Z = KST 2026-08-16(일) 00:00 — UTC로는 아직 토요일인 경계 순간 */
const SUN_KST_BOUNDARY = new Date('2026-08-15T15:00:00.000Z');

const ENV_KEYS = ['EXPO_PUBLIC_SCHEDULE_LIVE_HLS_URL', 'EXPO_PUBLIC_SCHEDULE_LIVE_TITLE'] as const;
const originalEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    originalEnv[key] = process.env[key];
    delete process.env[key];
  }
  jest.useFakeTimers();
  jest.setSystemTime(WED_KST);
});

afterEach(() => {
  jest.useRealTimers();
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

describe('정적 편성표 — api 무관 생존(04 §B④ 전제)', () => {
  it('fetch/XHR를 폭파해 둬도 화면 전체가 렌더된다 — 서버가 죽어도 보이는 페이지', async () => {
    const fetchSpy = jest.fn(() => {
      throw new Error('이 화면은 네트워크를 쓰면 안 된다');
    });
    const originalFetch = globalThis.fetch;
    const originalXhr = globalThis.XMLHttpRequest;
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;
    globalThis.XMLHttpRequest = function BrokenXhr() {
      throw new Error('이 화면은 네트워크를 쓰면 안 된다');
    } as unknown as typeof globalThis.XMLHttpRequest;

    try {
      const { getByText } = await render(<ScheduleScreen />);

      // 제목·오늘·편성 표·긴급·안내가 전부 그대로 나온다
      expect(getByText('방송 편성표')).toBeTruthy();
      expect(getByText('2026년 8월 19일 수요일 · 제주 기준')).toBeTruthy();
      expect(getByText('이번 주 편성')).toBeTruthy();
      expect(getByText('주간뉴스 생방송')).toBeTruthy();
      expect(getByText('긴급 방송')).toBeTruthy();
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = originalFetch;
      globalThis.XMLHttpRequest = originalXhr;
    }
  });

  it('7일 편성이 오늘(수)부터 순서대로 전부 렌더된다', async () => {
    const { getByText } = await render(<ScheduleScreen />);
    for (const day of ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일']) {
      expect(getByText(day)).toBeTruthy();
    }
    // 오늘 표식은 정확히 1개
    expect(getByText('오늘')).toBeTruthy();
  });

  it('시청자 화면에는 기술 용어(HLS·VOD·라이브 세션) 대신 생활어만 쓴다(03 §A)', async () => {
    const { queryByText, getAllByText } = await render(<ScheduleScreen />);
    // '생방송' 뱃지는 토·일 2개, '새 영상' 뱃지는 월~금 5개
    expect(getAllByText('생방송')).toHaveLength(2);
    expect(getAllByText('새 영상')).toHaveLength(5);
    expect(queryByText(/HLS|VOD|라이브 세션|m3u8/)).toBeNull();
  });
});

describe('게시된 생방송 URL(04 §B④ "HLS URL 직접 포함")', () => {
  it('미게시 상태에서는 재생 영역이 아예 없고 다음 생방송만 안내한다', async () => {
    const { getByText, queryByText } = await render(<ScheduleScreen />);

    expect(getByText('지금 진행 중인 생방송이 없습니다')).toBeTruthy();
    // 수요일 → 3일 뒤 토요일 주간뉴스
    expect(getByText('다음 생방송은 3일 뒤(토요일) 주간뉴스 생방송입니다.')).toBeTruthy();
    expect(queryByText(/^PLAYER:/)).toBeNull();
  });

  it('게시하면 세션 조회 없이 그 URL로 바로 재생 영역이 뜬다', async () => {
    process.env.EXPO_PUBLIC_SCHEDULE_LIVE_HLS_URL = VALID_HLS;
    process.env.EXPO_PUBLIC_SCHEDULE_LIVE_TITLE = '8월 셋째 주 주간뉴스';

    const { getByText, queryByText } = await render(<ScheduleScreen />);

    expect(getByText('지금 방송 중')).toBeTruthy();
    expect(getByText('8월 셋째 주 주간뉴스')).toBeTruthy();
    expect(getByText(`PLAYER:${VALID_HLS}`)).toBeTruthy();
    expect(queryByText('지금 진행 중인 생방송이 없습니다')).toBeNull();
  });

  it('제목 없이 URL만 게시해도 기본 제목으로 재생된다', async () => {
    process.env.EXPO_PUBLIC_SCHEDULE_LIVE_HLS_URL = VALID_HLS;
    const { getByText } = await render(<ScheduleScreen />);
    expect(getByText('제주방송센터 생방송')).toBeTruthy();
    expect(getByText(`PLAYER:${VALID_HLS}`)).toBeTruthy();
  });

  it('잘못 게시된 값(http)은 재생 영역을 만들지 않는다 — 가짜로 되는 척하지 않는다', async () => {
    process.env.EXPO_PUBLIC_SCHEDULE_LIVE_HLS_URL = 'http://cdn.example/live/index.m3u8';
    const { getByText, queryByText } = await render(<ScheduleScreen />);
    expect(getByText('지금 진행 중인 생방송이 없습니다')).toBeTruthy();
    expect(queryByText(/^PLAYER:/)).toBeNull();
  });
});

describe('요일 판정 — 제주(KST) 기준', () => {
  it('UTC로는 토요일인 순간에도 제주 기준 일요일 편성을 보여준다', async () => {
    jest.setSystemTime(SUN_KST_BOUNDARY);
    expect(SUN_KST_BOUNDARY.getUTCDay()).toBe(6); // 기기(UTC)는 토요일

    const { getByText } = await render(<ScheduleScreen />);
    expect(getByText('2026년 8월 16일 일요일 · 제주 기준')).toBeTruthy();
    // 일요일은 생방송 당일이므로 "다음 생방송은 오늘"
    expect(getByText('다음 생방송은 오늘(일요일) 교양·정치인 대담 생방송입니다.')).toBeTruthy();
  });
});
