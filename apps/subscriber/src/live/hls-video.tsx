import { useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';

/**
 * hls.js 어댑터 — 네이티브(iOS/Android) 기본 구현. 이 파일이 `import ... from './hls-video'`의
 * 기본 해석 대상이다(tsc는 플랫폼 확장자를 모르므로 항상 이 파일 기준으로 타입체크한다 — 아래
 * `hls-video.web.tsx`가 동일 `HlsVideoProps`를 재수출해 두 구현의 타입 표면을 맞춘다).
 *
 * 네이티브는 expo-video(AVPlayer/ExoPlayer)가 HLS를 플랫폼 자체 지원으로 재생하므로 hls.js가
 * 필요 없다 — T-W1-03 착수 전 조사 결론(hls.js는 웹 전용) 그대로, 舊 `app/live/[id].tsx`의
 * `PlayingView` 로직을 이 컴포넌트로 옮겼을 뿐 네이티브 재생 경로 자체는 무변경이다.
 */
export interface HlsVideoProps {
  /** 라이브 HLS(.m3u8) 재생 URL */
  sourceUrl: string;
  /** 치명적 재생 실패(디코딩·네트워크 등) 시 1회 호출 — 상위가 폴백 UI로 전환 */
  onFatalError?: () => void;
}

export function HlsVideo({ sourceUrl, onFatalError }: HlsVideoProps): React.JSX.Element {
  const player = useVideoPlayer(sourceUrl, (p) => {
    p.play();
  });

  useEffect(() => {
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onFatalError?.();
    });
    return () => sub.remove();
  }, [player, onFatalError]);

  return (
    <View style={styles.wrap}>
      <VideoView player={player} style={styles.player} nativeControls />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  player: { width: '100%', height: '100%' },
});
