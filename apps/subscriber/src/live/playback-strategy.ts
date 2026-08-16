/**
 * 웹 HLS 재생 전략 판정 — `hls-video.web.tsx`의 `Hls.isSupported()`/`canPlayType()` 분기를
 * 순수 함수로 뽑아낸 것(보강 2). DOM·hls.js 없이도 판정 자체를 단위 테스트할 수 있어야
 * 이 분기가 실제로 지켜지는지 코드 읽기가 아니라 테스트로 담보된다.
 */
export type PlaybackStrategy = 'hlsjs' | 'native' | 'unsupported';

export interface PlaybackCapabilities {
  /** `Hls.isSupported()` — MSE 기반 재생 가능 여부(Chrome/Edge/삼성인터넷 등) */
  hlsSupported: boolean;
  /** `videoEl.canPlayType('application/vnd.apple.mpegurl')` truthy 여부(Safari 네이티브 HLS) */
  canPlayNativeHls: boolean;
}

/** hls.js 우선(MSE 지원 브라우저는 항상 hls.js) → Safari 네이티브 → 둘 다 안 되면 재생 실패로 간주 */
export function selectPlaybackStrategy({
  hlsSupported,
  canPlayNativeHls,
}: PlaybackCapabilities): PlaybackStrategy {
  if (hlsSupported) return 'hlsjs';
  if (canPlayNativeHls) return 'native';
  return 'unsupported';
}
