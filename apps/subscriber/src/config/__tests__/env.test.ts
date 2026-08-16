import { getLiveFallbackYoutubeUrl, getSupportTelHref } from '../env';
import { resolveLiveFallbackButtons } from '../../ui/playback-fallback';

/**
 * 보강 1 수용 기준 실측 — "env 미설정 상태에서 라이브 폴백의 동작 가능한 버튼이 1개 이상"을
 * 프로덕션 함수 그대로(env.ts의 실 env 판독 + playback-fallback.tsx의 실 버튼 판정) 엮어
 * 증명한다. 이 조합이 qa-verifier가 실측한 결함(`{"primaryDisabled":true,"secondaryDisabled":true}`)
 * 의 재발 방지 테스트다.
 */
describe('env 미설정 기본 배포 — 라이브 폴백 가용 버튼 증명(보강 1)', () => {
  const ORIGINAL_TEL = process.env.EXPO_PUBLIC_SUPPORT_TEL;
  const ORIGINAL_YOUTUBE = process.env.EXPO_PUBLIC_LIVE_YOUTUBE_URL;

  beforeEach(() => {
    delete process.env.EXPO_PUBLIC_SUPPORT_TEL;
    delete process.env.EXPO_PUBLIC_LIVE_YOUTUBE_URL;
  });

  afterAll(() => {
    if (ORIGINAL_TEL !== undefined) process.env.EXPO_PUBLIC_SUPPORT_TEL = ORIGINAL_TEL;
    if (ORIGINAL_YOUTUBE !== undefined) {
      process.env.EXPO_PUBLIC_LIVE_YOUTUBE_URL = ORIGINAL_YOUTUBE;
    }
  });

  test('두 env 모두 null로 판독된다(현재 리포·.env.example 실태와 일치)', () => {
    expect(getSupportTelHref()).toBeNull();
    expect(getLiveFallbackYoutubeUrl()).toBeNull();
  });

  test('그 null 값을 그대로 넘겨도 라이브 폴백 버튼은 1개 이상이며, 그 1개는 "다시 시도"다', () => {
    const buttons = resolveLiveFallbackButtons({
      youtubeUrl: getLiveFallbackYoutubeUrl(),
      supportTelHref: getSupportTelHref(),
    });
    expect(buttons.length).toBeGreaterThanOrEqual(1);
    expect(buttons[0]).toEqual({ key: 'retry', label: '다시 시도' });
  });
});
