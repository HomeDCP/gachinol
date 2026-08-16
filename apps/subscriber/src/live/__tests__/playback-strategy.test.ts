import { selectPlaybackStrategy } from '../playback-strategy';

describe('selectPlaybackStrategy', () => {
  test('MSE 지원(hlsSupported) → hlsjs, Safari 네이티브 지원 여부와 무관하게 우선', () => {
    expect(selectPlaybackStrategy({ hlsSupported: true, canPlayNativeHls: true })).toBe('hlsjs');
    expect(selectPlaybackStrategy({ hlsSupported: true, canPlayNativeHls: false })).toBe('hlsjs');
  });

  test('MSE 미지원 + 네이티브 HLS 지원(Safari) → native', () => {
    expect(selectPlaybackStrategy({ hlsSupported: false, canPlayNativeHls: true })).toBe(
      'native',
    );
  });

  test('둘 다 미지원(구형 브라우저) → unsupported', () => {
    expect(selectPlaybackStrategy({ hlsSupported: false, canPlayNativeHls: false })).toBe(
      'unsupported',
    );
  });
});
