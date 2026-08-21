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
  ProductCard,
  ProductCardId,
  ProductId,
  ProgramCategory,
  StationId,
  UserId,
  WeeklyRecommendationId,
} from '@gachinol/shared';
import { isSafeLinkoutUrl, toId } from '@gachinol/shared';
import type {
  ChatMessage as ChatMessageRow,
  LiveComment as LiveCommentRow,
  LiveSession as LiveSessionRow,
} from '@prisma/client';

const iso = (d: Date | null): string | null => (d ? d.toISOString() : null);

/**
 * `live_sessions.product_cards`(JSONB) → shared `ProductCard[]` 방어적 파싱.
 *
 * ★ 계약 밖 항목은 **버리고 나머지를 살린다**(예외를 던지지 않는다). 주간추천에서 밟은 함정의 반대편이다 —
 *   거기서는 계약 밖 값 1건이 목록·상세를 **영구 500**으로 만들었다. 상품 카드는 라이브 화면의
 *   부수 요소이므로, 한 카드가 깨졌다고 **방송 자체가 안 보이는 것이 훨씬 나쁘다**.
 *   쓰기 경계(zod `zProductCardInput`)가 이미 검증하므로 여기 걸리는 값은 수기 DB 수정·구버전 잔재뿐이다.
 * ★ `url`을 **읽을 때도** `isSafeLinkoutUrl`로 다시 본다: 쓰기 검증이 도입되기 전에 들어간 행이나
 *   마이그레이션으로 옮겨온 값이 공개 화면에 그대로 나가는 경로를 막는다(fail-closed).
 */
export const toProductCards = (raw: unknown): ProductCard[] => {
  if (!Array.isArray(raw)) return [];
  const out: ProductCard[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const c = item as Record<string, unknown>;
    if (typeof c.id !== 'string' || c.id.length === 0) continue;
    if (typeof c.name !== 'string' || c.name.length === 0) continue;
    if (!isSafeLinkoutUrl(c.url)) continue;
    out.push({
      id: toId<ProductCardId>(c.id),
      name: c.name,
      url: c.url,
      ...(isSafeLinkoutUrl(c.imageUrl) ? { imageUrl: c.imageUrl } : {}),
      ...(typeof c.priceLabel === 'string' ? { priceLabel: c.priceLabel } : {}),
    });
  }
  return out;
};

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
  productCards: toProductCards(row.productCards),
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
  // 공개 대상이 맞다 — 카드는 애초에 시청자에게 보여주려고 만든 표시 자산이고,
  // 내부 식별자·판매자 정보·가격 숫자를 담지 않는다(commerce/product-card.ts 참조).
  productCards: toProductCards(row.productCards),
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
