/**
 * 주민 업로드 공유 URL 구성(T-W2-35) — AC2.
 *
 * 주민 소비 화면은 구독자 웹(`apps/subscriber/app/upload/[token].tsx`)에 있으므로 공유 URL은
 * `<구독자 오리진>/upload/<token>`이다. 오리진 결정 우선순위:
 *   ① `EXPO_PUBLIC_SUBSCRIBER_WEB_URL`(명시 설정 — 도메인 보류 중엔 Tailscale 오리진을 넣는다)
 *   ② 웹 실행 중 호스트가 `reporter.<rest>`면 `watch.<rest>` 유도(infra/docker/nginx.conf의
 *      vhost 명명 규칙 — watch./reporter./center.<DOMAIN>)
 *   ③ 둘 다 불가 → null (화면은 경로만 표시하고 설정 안내로 강등 — 조용히 틀린 URL을 만들지 않는다)
 */
import { buildResidentUploadUrl, deriveSubscriberOrigin } from '../issue';

describe('deriveSubscriberOrigin — reporter.* → watch.* 유도', () => {
  test('reporter.<도메인> 호스트에서 watch.<도메인> 오리진을 유도한다', () => {
    expect(deriveSubscriberOrigin({ protocol: 'https:', host: 'reporter.gachinol.kr' })).toBe(
      'https://watch.gachinol.kr',
    );
  });

  test('포트가 있으면 보존한다', () => {
    expect(
      deriveSubscriberOrigin({ protocol: 'http:', host: 'reporter.gachinol.local:8080' }),
    ).toBe('http://watch.gachinol.local:8080');
  });

  test('reporter. 접두가 아니면 null — localhost 개발 서버에서 추측하지 않는다', () => {
    expect(deriveSubscriberOrigin({ protocol: 'http:', host: 'localhost:8081' })).toBeNull();
    expect(deriveSubscriberOrigin(null)).toBeNull();
  });
});

describe('buildResidentUploadUrl — 우선순위·정규화', () => {
  test('① baseUrl(env)이 있으면 그것으로 만든다 — 꼬리 슬래시 유무 무관', () => {
    expect(buildResidentUploadUrl('tok-1', { baseUrl: 'https://watch.example.com' })).toBe(
      'https://watch.example.com/upload/tok-1',
    );
    expect(buildResidentUploadUrl('tok-1', { baseUrl: 'https://watch.example.com/' })).toBe(
      'https://watch.example.com/upload/tok-1',
    );
  });

  test('빈 문자열 baseUrl은 미설정으로 취급한다 — Dockerfile ARG 기본값이 빈 값이다(#146)', () => {
    expect(
      buildResidentUploadUrl('tok-1', {
        baseUrl: '',
        webLocation: { protocol: 'https:', host: 'reporter.gachinol.kr' },
      }),
    ).toBe('https://watch.gachinol.kr/upload/tok-1');
  });

  test('② baseUrl 미설정이면 웹 호스트에서 유도한다', () => {
    expect(
      buildResidentUploadUrl('tok-2', {
        webLocation: { protocol: 'https:', host: 'reporter.gachinol.kr' },
      }),
    ).toBe('https://watch.gachinol.kr/upload/tok-2');
  });

  test('③ 둘 다 불가하면 null — 틀린 URL을 지어내지 않는다', () => {
    expect(buildResidentUploadUrl('tok-3', {})).toBeNull();
    expect(
      buildResidentUploadUrl('tok-3', {
        webLocation: { protocol: 'http:', host: 'localhost:8081' },
      }),
    ).toBeNull();
  });
});
