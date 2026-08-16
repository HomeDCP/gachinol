import type {
  CaptionCue,
  ContentId,
  CultureTopic,
  FeedItem,
  PlaybackInfo,
  ProgramCategory,
  Scene,
  StationId,
  StationStatus,
  StationSummary,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type { Content as ContentRow, Station as StationRow } from '@prisma/client';

/** 목록 조회 include 결과 — 비정규화 stationName 채움용 */
export type FeedContentRow = ContentRow & { station: { name: string } };

/**
 * published Content row → 공개 FeedItem 화이트리스트 투영.
 * ★ row를 절대 spread하지 않는다 — 명시 필드만 대입해 내부 필드(reporterId·status·origin·
 *   generation·tags·targetChannelAccountIds·lastError 등)를 구조적으로 차단.
 * 서명(thumbnailUrl)·요약(summary)은 서비스가 채워 opts로 전달(매퍼는 순수).
 */
export const toFeedItem = (
  row: FeedContentRow,
  opts: { thumbnailUrl?: string; summary?: string },
): FeedItem => {
  const item: FeedItem = {
    contentId: toId<ContentId>(row.id),
    title: row.title,
    category: row.category as ProgramCategory,
    stationId: toId<StationId>(row.stationId),
    stationName: row.station.name,
    durationSec: row.durationSec ?? 0,
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
  };
  if (row.cultureTopics.length) item.cultureTopics = row.cultureTopics as CultureTopic[];
  if (opts.thumbnailUrl) item.thumbnailUrl = opts.thumbnailUrl;
  if (opts.summary) item.summary = opts.summary;
  return item;
};

/**
 * 장면 배열 → 자막 큐. 타이밍(startSec·endSec 둘 다 non-null)이 있고 caption이 비어있지
 * 않은 장면만 order 오름차순으로. 타이밍 없는 장면은 타임라인 배치 불가라 제외.
 */
export const scenesToCaptions = (scenes: readonly Scene[]): CaptionCue[] =>
  [...scenes]
    .filter((s) => s.startSec != null && s.endSec != null && s.caption.trim().length > 0)
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ startSec: s.startSec as number, endSec: s.endSec as number, text: s.caption }));

/**
 * published Content row → PlaybackInfo 화이트리스트 투영.
 * 서명 URL(hlsUrl·posterUrl)·자막·durationSec은 서비스가 조립해 opts로 전달.
 */
export const toPlaybackInfo = (
  row: ContentRow,
  stationName: string,
  opts: {
    hlsUrl: string;
    posterUrl?: string;
    captions: readonly CaptionCue[];
    durationSec: number;
  },
): PlaybackInfo => {
  const info: PlaybackInfo = {
    contentId: toId<ContentId>(row.id),
    title: row.title,
    stationName,
    hlsUrl: opts.hlsUrl,
    durationSec: opts.durationSec,
    captions: opts.captions,
    publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
  };
  if (opts.posterUrl) info.posterUrl = opts.posterUrl;
  return info;
};

/**
 * Station row → 공개 StationSummary 축약(전체 Station 엔티티 노출 금지).
 *
 * supportTel·youtubeUrl은 **공개 목적의 연락 채널**이라 익명 응답에 싣는다(T-W2-28 · 대장 #127):
 * 재생 실패 폴백의 "지사에 전화 / 유튜브에서 보기"가 지사 단위로 성립하려면 이 관문을 통과해야
 * 한다. 개인 연락처(CommunityFigure)는 여기로 나가지 않는다 — PII 판정 근거는 shared
 * `Station.supportTel` 주석. `if (값)` 가드라 빈 문자열·null은 **키 자체가 생기지 않는다**
 * (앱이 "설정됨"으로 오판해 목적지 없는 버튼을 그리는 것을 투영 경계에서 막는다).
 */
export const toStationSummary = (row: StationRow): StationSummary => {
  const s: StationSummary = {
    id: toId<StationId>(row.id),
    name: row.name,
    region: row.region,
    status: row.status as StationStatus,
  };
  if (row.thumbnailUrl) s.thumbnailUrl = row.thumbnailUrl;
  const supportTel = row.supportTel?.trim();
  if (supportTel) s.supportTel = supportTel;
  const youtubeUrl = row.youtubeUrl?.trim();
  if (youtubeUrl) s.youtubeUrl = youtubeUrl;
  return s;
};
