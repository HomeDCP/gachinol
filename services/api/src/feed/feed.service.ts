import { Injectable } from '@nestjs/common';
import type {
  CursorPage,
  FeedItem,
  PlaybackInfo,
  StationSummary,
  TextAnalysis,
} from '@gachinol/shared';
import type { MediaAsset as MediaAssetRow, Prisma } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../media/s3.service';
import { zScene } from '../contents/schemas/content.schemas';
import { decodeFeedCursor, encodeFeedCursor, type FeedCursor } from './feed.cursor';
import { scenesToCaptions, toFeedItem, toPlaybackInfo, toStationSummary } from './feed.mapper';
import type { FeedQueryDto } from './schemas/feed.schemas';

/** (contentId, generation) 복합 키 — 세대 정합 배치 조회 맵 키 */
const genKey = (contentId: string, generation: number): string => `${contentId}:${generation}`;

/**
 * 공개 피드 read 서비스 — published-only 투영·서명 재생 URL·공개 지사 목록.
 * 익명 접근이라 모든 응답은 화이트리스트 매퍼를 거쳐 내부 필드 유출을 구조적으로 차단한다.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
  ) {}

  /** GET /v1/feed — published 커서 목록. 썸네일 서명은 best-effort(피드 절대 500 금지). */
  async list(query: FeedQueryDto): Promise<CursorPage<FeedItem>> {
    const limit = query.limit;
    let cursor: FeedCursor | null = null;
    if (query.cursor !== undefined) {
      cursor = decodeFeedCursor(query.cursor);
      // 커서는 항상 서버 발급 opaque — 손상=버그/변조 → fail-closed
      if (!cursor) throw new DomainException('validation_failed', '잘못된 커서입니다');
    }

    const where: Prisma.ContentWhereInput = {
      status: 'published',
      ...(query.stationId ? { stationId: query.stationId } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(cursor
        ? {
            // keyset: published_at < cur OR (published_at = cur AND id < cur.id)
            OR: [
              { publishedAt: { lt: new Date(cursor.publishedAt) } },
              { publishedAt: new Date(cursor.publishedAt), id: { lt: cursor.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prisma.content.findMany({
      where,
      include: { station: { select: { name: true } } },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1, // +1로 다음 페이지 유무 판정
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const ids = page.map((r) => r.id);

    // 썸네일·요약 배치 조회(N+1 회피). content.generation 일치분만 채택.
    const [thumbs, analyses] = ids.length
      ? await Promise.all([
          this.prisma.mediaAsset.findMany({
            where: { contentId: { in: ids }, kind: 'thumbnail', status: 'ready' },
          }),
          this.prisma.aiAnalysis.findMany({
            where: { contentId: { in: ids } },
            select: { contentId: true, generation: true, text: true },
          }),
        ])
      : [[] as MediaAssetRow[], [] as { contentId: string; generation: number; text: unknown }[]];

    const thumbMap = new Map<string, MediaAssetRow>();
    for (const t of thumbs) {
      if (t.contentId) thumbMap.set(genKey(t.contentId, t.generation), t);
    }
    const summaryMap = new Map<string, string>();
    for (const a of analyses) {
      const text = a.text as TextAnalysis | null;
      if (text?.summary) summaryMap.set(genKey(a.contentId, a.generation), text.summary);
    }

    const items: FeedItem[] = [];
    for (const row of page) {
      const k = genKey(row.id, row.generation);
      const thumb = thumbMap.get(k);
      let thumbnailUrl: string | undefined;
      if (thumb) {
        try {
          thumbnailUrl = (await this.s3.presignGet(thumb.storageKey)).url;
        } catch {
          // S3 자격 미설정 등 — 피드는 절대 500 금지, thumbnailUrl 생략
          thumbnailUrl = undefined;
        }
      }
      const summary = summaryMap.get(k);
      items.push(toFeedItem(row, { thumbnailUrl, summary }));
    }

    const last = page[page.length - 1];
    const nextCursor =
      hasMore && last?.publishedAt ? encodeFeedCursor(last.publishedAt.toISOString(), last.id) : null;

    return { items, nextCursor };
  }

  /** GET /v1/feed/:id/playback — 비published(초안·처리중·내부)는 404. hlsUrl은 required라 서명 실패 시 500. */
  async getPlayback(id: string): Promise<PlaybackInfo> {
    const row = await this.prisma.content.findUnique({
      where: { id },
      include: { station: { select: { name: true } } },
    });
    if (!row || row.status !== 'published') {
      throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    }

    // 현 세대 ready rendition — 720p 우선, 없으면 최신 createdAt
    const renditions = await this.prisma.mediaAsset.findMany({
      where: { contentId: id, kind: 'rendition', generation: row.generation, status: 'ready' },
      orderBy: { createdAt: 'desc' },
    });
    const rendition = renditions.find((r) => r.renditionLabel === '720p') ?? renditions[0];
    if (!rendition) throw new DomainException('not_found', '재생 가능한 렌디션이 없습니다');
    const hlsUrl = (await this.s3.presignGet(rendition.storageKey)).url;

    // 포스터(썸네일) — best-effort, optional
    let posterUrl: string | undefined;
    const thumb = await this.prisma.mediaAsset.findFirst({
      where: { contentId: id, kind: 'thumbnail', generation: row.generation, status: 'ready' },
      orderBy: { createdAt: 'desc' },
    });
    if (thumb) {
      try {
        posterUrl = (await this.s3.presignGet(thumb.storageKey)).url;
      } catch {
        posterUrl = undefined;
      }
    }

    const scenes = zScene.array().parse(row.scenes);
    const captions = scenesToCaptions(scenes);
    const durationSec = row.durationSec ?? rendition.durationSec ?? 0;

    return toPlaybackInfo(row, row.station.name, { hlsUrl, posterUrl, captions, durationSec });
  }

  /** GET /v1/feed/stations — 지사(branch)만, operating+dormant 노출(center=라이브 허브·planned=미확정 제외). */
  async listPublicStations(): Promise<readonly StationSummary[]> {
    const rows = await this.prisma.station.findMany({
      where: { kind: 'branch', status: { in: ['operating', 'dormant'] } },
      orderBy: { sortOrder: 'asc' },
    });
    return rows.map(toStationSummary);
  }
}
