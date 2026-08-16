import { useEffect, useState } from 'react';
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { toId } from '@gachinol/shared';
import type { CaptionCue, ContentId } from '@gachinol/shared';
import { colors, radii, spacing, typo } from '@gachinol/ui';
import { isApiClientError, userMessageForError } from '../../src/api/errors';
import { getSupportTelHref } from '../../src/config/env';
import { selectActiveCue } from '../../src/features/feed/captions';
import { formatRelativeTime } from '../../src/features/feed/format';
import { usePlayback, usePublicStations } from '../../src/features/feed/queries';
import { findStationFor, resolveStationContact } from '../../src/features/stations/contact';
import { markWatchedOnce } from '../../src/features/home/home-banner';
import { ErrorView } from '../../src/ui/error-view';
import { LoadingView } from '../../src/ui/loading-view';
import {
  PlaybackFallback,
  resolvePlaybackFallbackMessage,
  resolveVodFallbackButtons,
} from '../../src/ui/playback-fallback';
import { Screen } from '../../src/ui/screen';

/**
 * 재생 플레이어 격리 — 서명 재생 URL(hlsUrl: 현재 720p mp4 서명 GET URL, 앱은 불투명 취급)로 재생하고
 * timeUpdate로 현재 시각을 구독해 활성 자막 큐를 오버레이한다. mp4라 hls.js 불요(hls.js는 라이브
 * 전용 — `src/live/hls-video*.tsx` 참조, 착수 전 조사 결론).
 */
function CaptionedPlayer({
  sourceUrl,
  captions,
  onFatalError,
}: {
  sourceUrl: string;
  captions: readonly CaptionCue[];
  onFatalError: () => void;
}): React.JSX.Element {
  const player = useVideoPlayer(sourceUrl, (p) => {
    p.timeUpdateEventInterval = 0.25;
  });
  const [now, setNow] = useState(0);

  useEffect(() => {
    const timeSub = player.addListener('timeUpdate', (payload) => {
      setNow(payload.currentTime);
    });
    const statusSub = player.addListener('statusChange', ({ status }) => {
      if (status === 'error') onFatalError();
    });
    return () => {
      timeSub.remove();
      statusSub.remove();
    };
  }, [player, onFatalError]);

  const activeCue = captions.length > 0 ? selectActiveCue(captions, now) : null;

  return (
    <View style={styles.playerWrap}>
      <VideoView player={player} style={styles.player} nativeControls />
      {activeCue ? (
        <View style={styles.captionBar} pointerEvents="none">
          <Text style={styles.captionText}>{activeCue.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** 홈화면 추가 배너(03 §A-5)의 노출 트리거 — 시청 화면 도달을 "1회 이상 시청" 신호로 기록(web만).
 * 저장 로직 자체는 `markWatchedOnce`(목 스토리지로 테스트됨, 보강 3) — 이 훅은 호출만 한다. */
function useMarkWatchedOnce(): void {
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    markWatchedOnce(window.localStorage);
  }, []);
}

/** 상세/재생 화면 — usePlayback으로 서명 URL·자막 로드 */
export default function WatchScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const contentId = toId<ContentId>(id ?? '');
  const playback = usePlayback(contentId);
  // 재생 실패 폴백의 "전화" 대체 경로를 **지사별로** 채우기 위한 공개 지사 목록(5분 캐시·익명 GET).
  // 실패했거나 아직 안 왔으면 undefined → env 폴백 → 그것도 없으면 버튼 자체를 숨긴다.
  const stations = usePublicStations();
  const [playbackFailed, setPlaybackFailed] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useMarkWatchedOnce();

  useEffect(() => {
    setPlaybackFailed(false);
  }, [contentId]);

  if (playback.isPending) {
    return (
      <Screen>
        <LoadingView />
      </Screen>
    );
  }
  if (playback.isError) {
    const err = playback.error;
    const notFound = isApiClientError(err) && err.status === 404;
    return (
      <Screen>
        <ErrorView
          message={userMessageForError(err)}
          retryLabel={notFound ? '목록으로' : '다시 시도'}
          onRetry={() => (notFound ? router.replace('/') : void playback.refetch())}
        />
      </Screen>
    );
  }

  const data = playback.data;
  // 서버(지사별) 값 우선 → 없으면 env 폴백 → 둘 다 없으면 null(그 버튼을 아예 렌더하지 않는다).
  // PlaybackInfo에는 stationId가 없어 비정규화된 stationName으로 지사를 찾는다(동명 2곳 이상이면
  // 매칭 포기 = 엉뚱한 지사로 전화 걸리는 것보다 안전) — contact.ts 주석 참조.
  const { supportTelHref } = resolveStationContact({
    station: findStationFor(stations.data, { stationName: data.stationName }),
    envSupportTelHref: getSupportTelHref(),
    // VOD 폴백에는 유튜브 경로가 없다(03 §A-6: 다시 시도 + 전화) → 해석 불요
    envYoutubeUrl: null,
  });
  const fallbackButtons = resolveVodFallbackButtons({ supportTelHref });
  const fallbackActions = fallbackButtons.map((button) =>
    button.key === 'retry'
      ? {
          label: button.label,
          onPress: () => {
            setPlaybackFailed(false);
            setRetryToken((n) => n + 1);
          },
        }
      : { label: button.label, onPress: () => void Linking.openURL(supportTelHref as string) },
  );

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        {playbackFailed ? (
          <PlaybackFallback
            message={resolvePlaybackFallbackMessage(fallbackActions.length)}
            actions={fallbackActions}
          />
        ) : (
          <CaptionedPlayer
            key={retryToken}
            sourceUrl={data.hlsUrl}
            captions={data.captions}
            onFatalError={() => setPlaybackFailed(true)}
          />
        )}
        <View style={styles.meta}>
          <Text style={styles.title}>{data.title}</Text>
          <Text style={styles.metaLine}>
            {data.stationName} · {formatRelativeTime(data.publishedAt)}
          </Text>
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { paddingBottom: spacing.xl },
  playerWrap: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000000' },
  player: { width: '100%', height: '100%' },
  captionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.lg,
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
  },
  captionText: {
    color: '#FFFFFF',
    backgroundColor: 'rgba(0,0,0,0.6)',
    fontSize: typo.body,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    overflow: 'hidden',
  },
  meta: { padding: spacing.lg, gap: spacing.xs },
  title: { fontSize: typo.title, fontWeight: '700', color: colors.text },
  metaLine: { fontSize: typo.caption, color: colors.textMuted },
});
