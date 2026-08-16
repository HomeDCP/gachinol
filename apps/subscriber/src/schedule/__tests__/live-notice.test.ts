import { getPublishedLiveNotice, parsePublishedLiveNotice } from '../live-notice';

/**
 * 방송별 HLS URL 게시 값 검증 — 04 §B④ 완화책의 알맹이.
 * 잘못 게시된 값으로 "되는 척"하지 않는다는 것이 이 파일이 고정하는 성질이다.
 */

const VALID = 'https://customer-abc123.cloudflarestream.com/deadbeef/manifest/video.m3u8';

describe('parsePublishedLiveNotice — 통과 조건', () => {
  it('https + .m3u8이면 통과한다(CF Stream 매니페스트 형태)', () => {
    expect(parsePublishedLiveNotice({ hlsUrl: VALID })).toEqual({ hlsUrl: VALID, title: null });
  });

  it('쿼리스트링(서명 파라미터)이 붙어도 통과한다', () => {
    const signed = `${VALID}?token=abc.def`;
    expect(parsePublishedLiveNotice({ hlsUrl: signed })?.hlsUrl).toBe(signed);
  });

  it('앞뒤 공백은 잘라낸다(복붙 사고 방어)', () => {
    expect(parsePublishedLiveNotice({ hlsUrl: `  ${VALID}\n` })?.hlsUrl).toBe(VALID);
  });

  it('제목을 함께 게시하면 실린다', () => {
    expect(parsePublishedLiveNotice({ hlsUrl: VALID, title: ' 8월 셋째 주 주간뉴스 ' })).toEqual({
      hlsUrl: VALID,
      title: '8월 셋째 주 주간뉴스',
    });
  });

  it('제목이 비어 있으면 null — 화면이 기본 제목으로 떨어진다', () => {
    expect(parsePublishedLiveNotice({ hlsUrl: VALID, title: '   ' })?.title).toBeNull();
  });
});

describe('parsePublishedLiveNotice — 거부 조건 (가짜 링크를 렌더하지 않는다)', () => {
  it('미게시(빈 값·공백·undefined·null)는 null', () => {
    expect(parsePublishedLiveNotice({})).toBeNull();
    expect(parsePublishedLiveNotice({ hlsUrl: '' })).toBeNull();
    expect(parsePublishedLiveNotice({ hlsUrl: '   ' })).toBeNull();
    expect(parsePublishedLiveNotice({ hlsUrl: null })).toBeNull();
  });

  it('http는 거부한다 — https 페이지에서 mixed content로 차단돼 눌러도 안 나온다', () => {
    expect(
      parsePublishedLiveNotice({ hlsUrl: 'http://cdn.example/live/index.m3u8' }),
    ).toBeNull();
  });

  it('javascript:·data: 등 위험 스킴을 거부한다', () => {
    expect(parsePublishedLiveNotice({ hlsUrl: 'javascript:alert(1)//x.m3u8' })).toBeNull();
    expect(parsePublishedLiveNotice({ hlsUrl: 'data:text/plain,x.m3u8' })).toBeNull();
  });

  it('.m3u8이 아니면 거부한다 — 유튜브 시청 페이지 링크를 넣는 실수를 막는다', () => {
    expect(parsePublishedLiveNotice({ hlsUrl: 'https://youtu.be/abcdefg' })).toBeNull();
    expect(parsePublishedLiveNotice({ hlsUrl: 'https://cdn.example/live/video.mp4' })).toBeNull();
  });

  it('.m3u8이 쿼리에만 있고 경로가 아니면 거부한다', () => {
    expect(
      parsePublishedLiveNotice({ hlsUrl: 'https://cdn.example/watch?src=video.m3u8' }),
    ).toBeNull();
  });

  it('URL 형식 자체가 깨지면 거부한다', () => {
    expect(parsePublishedLiveNotice({ hlsUrl: 'not a url .m3u8' })).toBeNull();
  });
});

describe('getPublishedLiveNotice — 빌드 시 주입 값 읽기', () => {
  const KEYS = ['EXPO_PUBLIC_SCHEDULE_LIVE_HLS_URL', 'EXPO_PUBLIC_SCHEDULE_LIVE_TITLE'] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of KEYS) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it('기본 배포(미게시)에서는 null — 존재하지 않는 방송을 만들어내지 않는다', () => {
    expect(getPublishedLiveNotice()).toBeNull();
  });

  it('게시하면 그 값이 그대로 나온다', () => {
    process.env.EXPO_PUBLIC_SCHEDULE_LIVE_HLS_URL = VALID;
    process.env.EXPO_PUBLIC_SCHEDULE_LIVE_TITLE = '주간뉴스';
    expect(getPublishedLiveNotice()).toEqual({ hlsUrl: VALID, title: '주간뉴스' });
  });

  it('import 시점이 아니라 호출 시점에 읽는다(테스트가 env를 갈아끼울 수 있어야 한다)', () => {
    expect(getPublishedLiveNotice()).toBeNull();
    process.env.EXPO_PUBLIC_SCHEDULE_LIVE_HLS_URL = VALID;
    expect(getPublishedLiveNotice()).not.toBeNull();
  });
});
