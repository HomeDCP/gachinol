import type {
  ChannelAccountId,
  ContentId,
  Publication,
  PublicationId,
  PublicationSource,
  PublicationStatus,
  UserId,
} from '@gachinol/shared';
import { toId } from '@gachinol/shared';
import type { Publication as PublicationRow } from '@prisma/client';
import type { Platform } from '@gachinol/shared';
import { DomainException } from '../common/errors/domain.exception';

/**
 * row → shared Publication. source_kind/content_id/live_session_id를 판별유니언 source로 재조립한다.
 * createdAt/updatedAt·credentialRef 등 내부·운영 필드는 wire에 투영하지 않는다(익명·센터 유출 차단).
 * 이번 슬라이스는 항상 kind='content' — live_session_id는 예약 컬럼(항상 null).
 */
export const toPublication = (row: PublicationRow): Publication => {
  const source = buildSource(row);
  return {
    id: toId<PublicationId>(row.id),
    source,
    channelAccountId: toId<ChannelAccountId>(row.channelAccountId),
    platform: row.platform as Platform,
    status: row.status as PublicationStatus,
    externalPostId: row.externalPostId ?? undefined,
    externalUrl: row.externalUrl ?? undefined,
    attempts: row.attempts,
    errorMessage: row.errorMessage ?? undefined,
    requestedByUserId: row.requestedByUserId ? toId<UserId>(row.requestedByUserId) : null,
    queuedAt: row.queuedAt.toISOString(),
    publishedAt: row.publishedAt ? row.publishedAt.toISOString() : null,
    retractedAt: row.retractedAt ? row.retractedAt.toISOString() : null,
  };
};

const buildSource = (row: PublicationRow): PublicationSource => {
  if (row.sourceKind === 'content') {
    if (!row.contentId) {
      throw new DomainException(
        'internal',
        '데이터 불변식 위반: source_kind=content인데 content_id가 없습니다',
        { publicationId: row.id },
      );
    }
    return { kind: 'content', contentId: toId<ContentId>(row.contentId) };
  }
  // live 소스는 이번 슬라이스 미도입(예약). 도달 시 데이터 불변식 위반.
  throw new DomainException('internal', `지원하지 않는 source_kind: ${row.sourceKind}`, {
    publicationId: row.id,
  });
};
