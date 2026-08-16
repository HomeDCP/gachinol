import { getKakaoChannelUrl, getSupportEmail, resolveSupportChannels } from '../support-contacts';

/**
 * 문의하기 연락 채널 해석 단위 테스트 (T-W1-09 · 06 §F-6).
 *
 * 고정하는 불변식:
 *  ① 설정된 채널만 06 §A 순서(전화 → 카톡 → 이메일)로 나온다.
 *  ② **값이 없으면 그 항목은 목록에서 사라진다** — 눌리지 않는 버튼을 만들지 않는다(Wave 8a 결함).
 *  ③ 열 수 없는 값(스킴 없는 카톡 URL·`@` 없는 이메일)은 "없음"과 같게 취급한다.
 */

const ENV_KEYS = ['EXPO_PUBLIC_KAKAO_CHANNEL_URL', 'EXPO_PUBLIC_SUPPORT_EMAIL'] as const;
const ORIGINAL = ENV_KEYS.map((key) => [key, process.env[key]] as const);

beforeEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

afterAll(() => {
  for (const [key, value] of ORIGINAL) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('resolveSupportChannels — 4요소 중 연락 채널 3종', () => {
  it('셋 다 설정되면 전화·카톡·이메일이 06 §A 순서로 전부 나온다', () => {
    const channels = resolveSupportChannels({
      telHref: 'tel:1670-0000',
      kakaoChannelUrl: 'https://pf.kakao.com/_center',
      email: 'help@example.org',
    });

    expect(channels.map((c) => c.key)).toEqual(['tel', 'kakao', 'email']);
  });

  it('전화는 화면에 `tel:` 접두사 없이 번호만 보여주고, href는 그대로 넘긴다', () => {
    const [tel] = resolveSupportChannels({
      telHref: 'tel:1670-0000',
      kakaoChannelUrl: null,
      email: null,
    });

    expect(tel?.value).toBe('1670-0000');
    expect(tel?.href).toBe('tel:1670-0000');
  });

  it('이메일은 mailto: href로 만든다', () => {
    const [email] = resolveSupportChannels({
      telHref: null,
      kakaoChannelUrl: null,
      email: 'help@example.org',
    });

    expect(email?.href).toBe('mailto:help@example.org');
    expect(email?.value).toBe('help@example.org');
  });

  it('값이 없는 항목은 목록에서 아예 빠진다 (흐린 버튼으로도 남기지 않는다)', () => {
    const channels = resolveSupportChannels({
      telHref: null,
      kakaoChannelUrl: 'https://pf.kakao.com/_center',
      email: null,
    });

    expect(channels.map((c) => c.key)).toEqual(['kakao']);
  });

  it('셋 다 없으면 빈 목록이다', () => {
    expect(
      resolveSupportChannels({ telHref: null, kakaoChannelUrl: null, email: null }),
    ).toHaveLength(0);
  });

  it('공백만 있는 값도 "없음"으로 본다', () => {
    const channels = resolveSupportChannels({
      telHref: '   ',
      kakaoChannelUrl: '\t',
      email: ' ',
    });

    expect(channels).toHaveLength(0);
  });

  it('각 채널의 안내 문구(운영시간·응답 약속)가 비어 있지 않다', () => {
    const channels = resolveSupportChannels({
      telHref: 'tel:1670-0000',
      kakaoChannelUrl: 'https://pf.kakao.com/_center',
      email: 'help@example.org',
    });

    for (const channel of channels) expect(channel.note.length).toBeGreaterThan(0);
  });
});

describe('getKakaoChannelUrl — env 판독', () => {
  it('미설정이면 null', () => {
    expect(getKakaoChannelUrl()).toBeNull();
  });

  it('http(s) URL이면 그대로 돌려준다', () => {
    process.env.EXPO_PUBLIC_KAKAO_CHANNEL_URL = 'https://pf.kakao.com/_center';
    expect(getKakaoChannelUrl()).toBe('https://pf.kakao.com/_center');
  });

  it('스킴 없는 채널 아이디만 넣으면 열 수 없으므로 null (죽은 링크 금지)', () => {
    process.env.EXPO_PUBLIC_KAKAO_CHANNEL_URL = '_center';
    expect(getKakaoChannelUrl()).toBeNull();
  });
});

describe('getSupportEmail — env 판독', () => {
  it('미설정이면 null (계정 개통 전 = 06 §F-20)', () => {
    expect(getSupportEmail()).toBeNull();
  });

  it('주소가 있으면 그대로 돌려준다', () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'help@example.org';
    expect(getSupportEmail()).toBe('help@example.org');
  });

  it('`@`가 없으면 mailto:로 열 수 없으므로 null', () => {
    process.env.EXPO_PUBLIC_SUPPORT_EMAIL = 'help-example-org';
    expect(getSupportEmail()).toBeNull();
  });
});
