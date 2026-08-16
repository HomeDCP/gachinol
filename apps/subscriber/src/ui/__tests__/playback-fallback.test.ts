import {
  resolveLiveFallbackButtons,
  resolvePlaybackFallbackMessage,
  resolveVodFallbackButtons,
} from '../playback-fallback';

describe('resolveLiveFallbackButtons — 보강 1: env 미설정(기본 배포)에서도 최소 1개는 항상 동작', () => {
  test('유튜브·전화 둘 다 미설정 → "다시 시도" 1개만(둘 다 disabled인 죽은 화면 금지)', () => {
    const buttons = resolveLiveFallbackButtons({ youtubeUrl: null, supportTelHref: null });
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toEqual({ key: 'retry', label: '다시 시도' });
  });

  test('유튜브만 설정 → 다시 시도 + 유튜브에서 보기', () => {
    const buttons = resolveLiveFallbackButtons({
      youtubeUrl: 'https://youtube.com/live/abc',
      supportTelHref: null,
    });
    expect(buttons.map((b) => b.key)).toEqual(['retry', 'youtube']);
  });

  test('전화만 설정 → 다시 시도 + 전화로 문의하기', () => {
    const buttons = resolveLiveFallbackButtons({
      youtubeUrl: null,
      supportTelHref: 'tel:1670-0000',
    });
    expect(buttons.map((b) => b.key)).toEqual(['retry', 'tel']);
  });

  test('둘 다 설정 → 3개 전부', () => {
    const buttons = resolveLiveFallbackButtons({
      youtubeUrl: 'https://youtube.com/live/abc',
      supportTelHref: 'tel:1670-0000',
    });
    expect(buttons.map((b) => b.key)).toEqual(['retry', 'youtube', 'tel']);
  });

  test('렌더되는 모든 버튼에 label이 채워져 있다(빈 라벨 금지)', () => {
    const buttons = resolveLiveFallbackButtons({
      youtubeUrl: 'https://youtube.com/live/abc',
      supportTelHref: 'tel:1670-0000',
    });
    expect(buttons.every((b) => b.label.length > 0)).toBe(true);
  });
});

describe('resolveVodFallbackButtons — 보강 1: 동일 원칙(다시 시도 항상 포함)', () => {
  test('전화 미설정 → "다시 시도" 1개만', () => {
    const buttons = resolveVodFallbackButtons({ supportTelHref: null });
    expect(buttons).toEqual([{ key: 'retry', label: '다시 시도' }]);
  });

  test('전화 설정 → 다시 시도 + 전화로 문의하기', () => {
    const buttons = resolveVodFallbackButtons({ supportTelHref: 'tel:1670-0000' });
    expect(buttons.map((b) => b.key)).toEqual(['retry', 'tel']);
  });
});

describe('resolvePlaybackFallbackMessage — 버튼 수와 문구 정합(보강 1)', () => {
  test('버튼 1개 → "다시 시도해 주세요" 단수 문구', () => {
    expect(resolvePlaybackFallbackMessage(1)).toContain('다시 시도해 주세요');
  });

  test('버튼 2개 이상 → "다시 시도하거나 다른 곳에서" 복수 문구', () => {
    expect(resolvePlaybackFallbackMessage(2)).toContain('다른 곳에서');
    expect(resolvePlaybackFallbackMessage(3)).toContain('다른 곳에서');
  });

  test('1개 문구와 2개 이상 문구는 서로 다르다(상태와 문구가 항상 같이 바뀐다는 증거)', () => {
    expect(resolvePlaybackFallbackMessage(1)).not.toBe(resolvePlaybackFallbackMessage(2));
  });
});
