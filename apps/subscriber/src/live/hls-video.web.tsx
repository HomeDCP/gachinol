import { useEffect, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import Hls from 'hls.js';
import type { HlsVideoProps } from './hls-video';
import { selectPlaybackStrategy } from './playback-strategy';

export type { HlsVideoProps };

/**
 * hls.js 어댑터 — 웹 전용 구현(Metro 플랫폼 확장자로 웹 빌드에서만 이 파일이 선택된다. 네이티브
 * 빌드는 `hls-video.tsx`를 그대로 쓰며 이 파일은 아예 번들에 포함되지 않는다).
 *
 * **착수 전 조사 결론**: expo-video 웹 구현(`VideoView`)의 `nativeRef`는 문서상 HTMLVideoElement를
 * 가리키지만, 내부 `VideoPlayer.web`이 소스 URL을 자체적으로 `<video>.src`에 직접 대입하는 경로와
 * hls.js의 MediaSource 부착이 같은 엘리먼트를 두고 경합할 위험이 있어(둘 다 같은 `src`/버퍼 상태를
 * 소유하려 함) — expo-video를 아예 거치지 않고 순수 DOM `<video>`를 이 컴포넌트가 직접 생성·관리한다.
 * `View`의 ref는 react-native-web에서 실제 DOM 노드(호스트 엘리먼트)를 가리키므로 이를 컨테이너로 쓴다.
 *
 * 분기: Chrome/Edge/삼성인터넷 등 MSE 지원 브라우저는 `Hls.isSupported()`가 true → hls.js로 재생.
 * Safari(iOS/macOS)는 `<video>`가 HLS를 네이티브로 지원해 hls.js 없이 `src` 직접 대입으로 재생.
 * 둘 다 안 되면(구형 브라우저) 재생 실패로 간주해 상위 폴백 UI로 넘긴다.
 */
export function HlsVideo({ sourceUrl, onFatalError }: HlsVideoProps): React.JSX.Element {
  const containerRef = useRef<View>(null);
  const onFatalErrorRef = useRef(onFatalError);
  onFatalErrorRef.current = onFatalError;

  useEffect(() => {
    const container = containerRef.current as unknown as HTMLElement | null;
    if (!container) return undefined;

    const videoEl = document.createElement('video');
    videoEl.controls = true;
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    videoEl.style.width = '100%';
    videoEl.style.height = '100%';
    videoEl.style.backgroundColor = '#000000';
    container.appendChild(videoEl);

    let hls: Hls | null = null;
    let cancelled = false;
    const fail = (): void => {
      if (!cancelled) onFatalErrorRef.current?.();
    };

    const strategy = selectPlaybackStrategy({
      hlsSupported: Hls.isSupported(),
      canPlayNativeHls: Boolean(videoEl.canPlayType('application/vnd.apple.mpegurl')),
    });

    if (strategy === 'hlsjs') {
      hls = new Hls();
      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal) fail();
      });
      hls.loadSource(sourceUrl);
      hls.attachMedia(videoEl);
    } else if (strategy === 'native') {
      videoEl.src = sourceUrl;
      videoEl.addEventListener('error', fail);
    } else {
      fail();
    }

    return () => {
      cancelled = true;
      hls?.destroy();
      videoEl.removeEventListener('error', fail);
      container.removeChild(videoEl);
    };
    // sourceUrl 변경 시에만 재구성 — onFatalError는 ref로 우회해 매 렌더 재부착을 피한다.
    // (ref 우회 덕에 deps가 실제로 완전하므로 exhaustive-deps 예외가 필요 없다)
  }, [sourceUrl]);

  return <View ref={containerRef} style={styles.wrap} />;
}

const styles = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
});
