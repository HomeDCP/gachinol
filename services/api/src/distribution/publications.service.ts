import { Injectable } from '@nestjs/common';
import type { PublicationStatus } from '@gachinol/shared';
import type { Prisma, Publication as PublicationRow } from '@prisma/client';
import { newId } from '../common/ids';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import type { PublishResultItem } from './distribution-job';
import { canTransitionPublication } from './publication-status';

type Tx = Prisma.TransactionClient;

/** (content, channel) 활성/성공으로 간주되는 상태 — 부분 유니크와 동일 집합 */
const ACTIVE_STATUSES: readonly PublicationStatus[] = ['queued', 'publishing', 'published'];
/** content 판정 대상 — 현 송출 사이클 관련 상태(retracted/canceled 제외) */
const RELEVANT_STATUSES: readonly PublicationStatus[] = [
  'queued',
  'publishing',
  'published',
  'failed',
];

export interface CreateQueuedParams {
  contentId: string;
  channelAccountId: string;
  platform: string;
  requestedByUserId: string | null;
}

export interface ContentPublishSummary {
  anyPending: boolean;
  anyFailed: boolean;
  allPublished: boolean;
}

/**
 * publications의 유일 DB 기록자 — 상태 변경은 전부 shared 전이맵(canTransitionPublication) 검증 후 CAS.
 * 멱등: 활성 중복은 createQueued 사전검사 + 부분 유니크(하드가드), 잡 재수신은 상태 CAS no-op으로 수렴.
 */
@Injectable()
export class PublicationsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * queued Publication 멱등 생성. (content, channel) 활성 행이 이미 있으면 그것을 재사용(신규 미생성).
   * 사전검사로 정상경로 P2002를 회피한다(트랜잭션 내 P2002는 전체 tx를 abort시키므로).
   * 부분 유니크는 동시 distribute 경합의 하드가드로만 남는다(그 경우 tx 롤백→409).
   */
  async createQueued(tx: Tx, params: CreateQueuedParams): Promise<PublicationRow> {
    const existing = await tx.publication.findFirst({
      where: {
        contentId: params.contentId,
        channelAccountId: params.channelAccountId,
        status: { in: ACTIVE_STATUSES as string[] },
      },
    });
    if (existing) return existing;

    return tx.publication.create({
      data: {
        id: newId(),
        sourceKind: 'content',
        contentId: params.contentId,
        liveSessionId: null,
        channelAccountId: params.channelAccountId,
        platform: params.platform,
        status: 'queued',
        attempts: 0,
        requestedByUserId: params.requestedByUserId,
      },
    });
  }

  /** 최신순(createdAt desc) — GET /contents/:id/publications + ContentDetail */
  listForContent(contentId: string): Promise<PublicationRow[]> {
    return this.prisma.publication.findMany({
      where: { contentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  findById(id: string): Promise<PublicationRow | null> {
    return this.prisma.publication.findUnique({ where: { id } });
  }

  /** content의 현재 failed Publication 전부 — 콘텐츠 단위 재시도(requeueForStatus) 대상 */
  listFailedForContent(contentId: string): Promise<PublicationRow[]> {
    return this.prisma.publication.findMany({
      where: { contentId, status: 'failed' },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** queued→publishing CAS(+attempts). 이미 publishing/종결이면 count=0 no-op(멱등, 유실/재수신 수렴) */
  async beginPublishing(publicationId: string): Promise<boolean> {
    const res = await this.prisma.publication.updateMany({
      where: { id: publicationId, status: 'queued' },
      data: { status: 'publishing', attempts: { increment: 1 } },
    });
    return res.count > 0;
  }

  /**
   * 잡 완료 채널 결과 반영 — ensure(queued→publishing) 후 ok→published / !ok→failed.
   * 전부 publishing에서만 진행하는 CAS라 재수신·리컨사일에도 멱등(이미 종결이면 count=0 no-op).
   */
  async resolveResult(result: PublishResultItem): Promise<void> {
    await this.beginPublishing(result.publicationId); // ensure publishing
    if (result.ok) {
      await this.prisma.publication.updateMany({
        where: { id: result.publicationId, status: 'publishing' },
        data: {
          status: 'published',
          externalPostId: result.externalPostId ?? null,
          externalUrl: result.externalUrl ?? null,
          publishedAt: new Date(),
          errorMessage: null,
        },
      });
    } else {
      await this.prisma.publication.updateMany({
        where: { id: result.publicationId, status: 'publishing' },
        data: { status: 'failed', errorMessage: (result.error ?? '송출 실패').slice(0, 500) },
      });
    }
  }

  /** 잡 소진(인프라 장애) — queued/publishing Publication을 failed로. ensure publishing 후 fail */
  async failExhausted(publicationId: string, error: string): Promise<void> {
    await this.resolveResult({
      publicationId: publicationId as never,
      ok: false,
      error,
    });
  }

  /** content 판정 — allPublished/anyFailed/anyPending (retracted/canceled 제외) */
  async summarizeForContent(contentId: string): Promise<ContentPublishSummary> {
    const rows = await this.prisma.publication.findMany({
      where: { contentId, status: { in: RELEVANT_STATUSES as string[] } },
      select: { status: true },
    });
    if (rows.length === 0) {
      return { anyPending: false, anyFailed: false, allPublished: false };
    }
    let anyPending = false;
    let anyFailed = false;
    let allPublished = true;
    for (const r of rows) {
      if (r.status === 'queued' || r.status === 'publishing') anyPending = true;
      if (r.status === 'failed') anyFailed = true;
      if (r.status !== 'published') allPublished = false;
    }
    return { anyPending, anyFailed, allPublished };
  }

  /**
   * 콘텐츠 단위 재시도 — content의 failed Publication 전부를 failed→queued로 되돌리고 대상 행 반환.
   * 트랜잭션 밖 단발 CAS(this.prisma). 콘텐츠 retry() 커밋 후 재큐 직전에 호출된다.
   */
  async requeueFailedForContent(contentId: string): Promise<PublicationRow[]> {
    const failed = await this.listFailedForContent(contentId);
    const out: PublicationRow[] = [];
    for (const p of failed) {
      const ok = await this.retryToQueued(this.prisma, p.id, 'failed');
      if (ok) {
        const refreshed = await this.findById(p.id);
        if (refreshed) out.push(refreshed);
      }
    }
    return out;
  }

  /**
   * 채널 단위 재시도 — failed→queued CAS. 전이맵 검증 후 실행.
   * 이미 queued/publishing이면 count=0 → false(호출측이 409 판단).
   */
  async retryToQueued(tx: Tx, publicationId: string, from: PublicationStatus): Promise<boolean> {
    this.assertAllowed(from, 'queued');
    const res = await tx.publication.updateMany({
      where: { id: publicationId, status: from },
      data: { status: 'queued', errorMessage: null },
    });
    return res.count > 0;
  }

  /** 회수 — published→retracted CAS(+retractedAt). 목 어댑터 성공 후 호출 */
  async retract(tx: Tx, publicationId: string): Promise<boolean> {
    this.assertAllowed('published', 'retracted');
    const res = await tx.publication.updateMany({
      where: { id: publicationId, status: 'published' },
      data: { status: 'retracted', retractedAt: new Date() },
    });
    return res.count > 0;
  }

  private assertAllowed(from: PublicationStatus, to: PublicationStatus): void {
    if (!canTransitionPublication(from, to)) {
      throw new DomainException('invalid_transition', `허용되지 않는 송출 전이: ${from} → ${to}`, {
        from,
        to,
      });
    }
  }
}
