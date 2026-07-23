import type {
  ChannelAccountId,
  ChatMessage,
  ChatMessageId,
  ChatVisibility,
  ContentId,
  LiveComment,
  LiveCommentId,
  LiveCommentStatus,
  LiveSession,
  LiveSessionId,
  LiveSessionPublic,
  LiveSessionStatus,
  Platform,
  ProductId,
  ProgramCategory,
  StationId,
  UserId,
  WeeklyRecommendationId,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type {
  ChatMessage as ChatMessageRow,
  LiveComment as LiveCommentRow,
  LiveSession as LiveSessionRow,
} from '@prisma/client';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/** row → shared LiveSession(센터 전체 뷰). streamKeyRef는 참조 이름만(값 아님) — 그대로 투영. */
export const toLiveSession = (row: LiveSessionRow): LiveSession => ({
  id: toId<LiveSessionId>(row.id),
  type: row.type as ProgramCategory,
  title: row.title,
  description: row.description ?? undefined,
  status: row.status as LiveSessionStatus,
  hostStationId: toId<StationId>(row.hostStationId),
  announcerUserId: row.announcerUserId ? toId<UserId>(row.announcerUserId) : null,
  scheduledAt: iso(row.scheduledAt),
  startedAt: iso(row.startedAt),
  endedAt: iso(row.endedAt),
  rtmpIngestUrl: row.rtmpIngestUrl ?? null,
  streamKeyRef: row.streamKeyRef ?? null,
  hlsPlaybackUrl: row.hlsPlaybackUrl ?? null,
  targetChannelAccountIds: row.targetChannelAccountIds.map((id) => toId<ChannelAccountId>(id)),
  weeklyRecommendationId: row.weeklyRecommendationId
    ? toId<WeeklyRecommendationId>(row.weeklyRecommendationId)
    : null,
  productIds: row.productIds.map((id) => toId<ProductId>(id)),
  vodContentId: row.vodContentId ? toId<ContentId>(row.vodContentId) : null,
  createdByUserId: toId<UserId>(row.createdByUserId),
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
});

/**
 * row → 공개 LiveSessionPublic 화이트리스트 투영.
 * ★ row를 절대 spread하지 않는다 — 명시 필드만. streamKeyRef·rtmpIngestUrl·createdByUserId·
 *   targetChannelAccountIds·announcerUserId 등 내부 필드를 구조적으로 차단.
 * viewerCount는 게이트웨이 프레즌스에서 조회(미가용 시 0).
 */
export const toLiveSessionPublic = (row: LiveSessionRow, viewerCount: number): LiveSessionPublic => ({
  id: toId<LiveSessionId>(row.id),
  type: row.type as ProgramCategory,
  title: row.title,
  status: row.status as LiveSessionStatus,
  scheduledAt: iso(row.scheduledAt),
  hlsUrl: row.hlsPlaybackUrl ?? null,
  viewerCount,
});

/** row → shared LiveComment(프롬프터 표시용) */
export const toLiveComment = (row: LiveCommentRow): LiveComment => {
  const c: LiveComment = {
    id: toId<LiveCommentId>(row.id),
    liveSessionId: toId<LiveSessionId>(row.liveSessionId),
    channelAccountId: toId<ChannelAccountId>(row.channelAccountId),
    platform: row.platform as Platform,
    externalCommentId: row.externalCommentId,
    authorName: row.authorName,
    message: row.message,
    status: row.status as LiveCommentStatus,
    postedAt: row.postedAt.toISOString(),
    collectedAt: row.collectedAt.toISOString(),
  };
  if (row.authorExternalId) c.authorExternalId = row.authorExternalId;
  if (row.authorAvatarUrl) c.authorAvatarUrl = row.authorAvatarUrl;
  if (row.isQuestion) c.isQuestion = true;
  if (row.promptedAt) c.promptedAt = row.promptedAt.toISOString();
  return c;
};

/** row → shared ChatMessage(chat.new 브로드캐스트·ack 동일 개체) */
export const toChatMessage = (row: ChatMessageRow): ChatMessage => ({
  id: toId<ChatMessageId>(row.id),
  liveSessionId: toId<LiveSessionId>(row.liveSessionId),
  userId: toId<UserId>(row.userId),
  userName: row.userName,
  message: row.message,
  visibility: row.visibility as ChatVisibility,
  moderatedByUserId: row.moderatedByUserId ? toId<UserId>(row.moderatedByUserId) : null,
  sentAt: row.sentAt.toISOString(),
});
