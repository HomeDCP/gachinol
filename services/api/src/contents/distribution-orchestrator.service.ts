import { Injectable, Logger } from '@nestjs/common';
import type { DistributeContentRequest, Publication, User } from '@gachinol/shared';
import type {
  ChannelAccount as ChannelAccountRow,
  Content as ContentRow,
  Publication as PublicationRow,
} from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelAccountsService } from '../distribution/channel-accounts.service';
import { PublicationsService } from '../distribution/publications.service';
import { DistributionProducerService } from '../distribution/distribution-producer.service';
import { ChannelAdapterRegistry } from '../distribution/adapters/adapter.registry';
import { toPublication } from '../distribution/publication.mapper';
import { ContentWorkflowService } from './content-workflow.service';

/**
 * 다채널 송출 오케스트레이터 — 센터 트리거(distribute)·채널 재시도·회수의 진입점.
 * ContentWorkflowService(content 전이) + Distribution 코어 서비스(Publication·채널·생산자)를 조합한다.
 * 순서 규약: Publication 기록 먼저 → content 전이(관제 재조회 정합). 인큐는 항상 커밋 후(인큐-애프터-커밋).
 */
@Injectable()
export class DistributionOrchestratorService {
  private readonly logger = new Logger(DistributionOrchestratorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly workflow: ContentWorkflowService,
    private readonly publications: PublicationsService,
    private readonly channels: ChannelAccountsService,
    private readonly producer: DistributionProducerService,
    private readonly registry: ChannelAdapterRegistry,
  ) {}

  /**
   * POST /v1/contents/:id/distribute — center_approved 콘텐츠를 명시 송출.
   * ① center_approved 상태 가드 ② 대상 채널 해석 ③ 트랜잭션(content CAS center_approved→publishing +
   * 채널별 queued Publication 생성) ④ 커밋 후 인큐. reporter_only 자동 송출 후킹은 이 슬라이스 밖(무회귀).
   */
  async distribute(
    contentId: string,
    user: User,
    body?: DistributeContentRequest,
  ): Promise<readonly Publication[]> {
    const content = await this.loadContent(contentId);
    this.requireCenterActor(user);
    if (content.status !== 'center_approved') {
      throw new DomainException('conflict', '송출 가능한 상태가 아닙니다: center_approved 필요', {
        status: content.status,
      });
    }

    const targets = await this.channels.resolveTargets(content, body?.channelAccountIds);

    const created = await this.prisma.$transaction(async (tx) => {
      // content CAS center_approved→publishing (경합/중복 distribute는 여기서 409)
      await this.workflow.beginPublishing(tx, content, user);
      const rows: PublicationRow[] = [];
      for (const ch of targets) {
        rows.push(
          await this.publications.createQueued(tx, {
            contentId: content.id,
            channelAccountId: ch.id,
            platform: ch.platform,
            requestedByUserId: user.id,
          }),
        );
      }
      return rows;
    });

    // 커밋 후 인큐 — publishing 상태의 content로 재조회(generation/priority 정합)
    const publishing = await this.loadContent(contentId);
    await this.producer.enqueuePublish(publishing, created);

    return created.map(toPublication);
  }

  /**
   * reporter_only 자동 송출 — 기자 승인이 reporter_approved→publishing으로 자동 연쇄된 경우
   * (afterReporterApproval, content-workflow.service.ts) 담당 기자 액터로 소속 지사 카톡채널에 자동 송출한다.
   *
   * distribute()와의 차이:
   *  - content 전이 재수행 없음 — approve()가 이미 publishing으로 옮겼다(전제: content.status==='publishing').
   *  - requireCenterActor 없음 — 액터는 담당 기자(reporter_only의 정의: "기자 승인만으로 소속 지사 송출").
   * 대상 채널 0건이면 경고 로그 후 publishing 유지(운영 복구/재시도 대상 — 조용한 실패 금지).
   * 멱등: createQueued가 (content,channel) 활성 행 존재 시 재사용(부분 유니크 하드가드) → 재호출도 중복 미생성.
   */
  async startAutoDistribution(
    content: ContentRow,
    actorUser: User,
  ): Promise<readonly Publication[]> {
    if (content.status !== 'publishing') {
      // 방어 — 호출측(컨트롤러)이 publishing만 넘기지만 재확인(자동 송출은 publishing 전제)
      this.logger.warn(`자동 송출 대상 아님 — status=${content.status} (contentId=${content.id})`);
      return [];
    }

    let targets: ChannelAccountRow[];
    try {
      targets = await this.channels.resolveTargets(content, undefined);
    } catch (e) {
      if (e instanceof DomainException && e.code === 'conflict') {
        // 대상 채널 0건 — 고착 방지 위해 명시 경고(조용한 실패 금지). content는 publishing 유지(운영 복구).
        this.logger.warn(
          `reporter_only 자동 송출 대상 채널 없음 — publishing 유지 (contentId=${content.id})`,
        );
        return [];
      }
      throw e;
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const rows: PublicationRow[] = [];
      for (const ch of targets) {
        rows.push(
          await this.publications.createQueued(tx, {
            contentId: content.id,
            channelAccountId: ch.id,
            platform: ch.platform,
            requestedByUserId: actorUser.id,
          }),
        );
      }
      return rows;
    });

    // 커밋 후 인큐 — publishing 상태의 content로 재조회(generation/priority 정합)
    const publishing = await this.loadContent(content.id);
    await this.producer.enqueuePublish(publishing, created);

    return created.map(toPublication);
  }

  /** GET /v1/contents/:id/publications — 채널별 송출 상태(최신순) */
  async listForContent(contentId: string): Promise<readonly Publication[]> {
    const rows = await this.publications.listForContent(contentId);
    return rows.map(toPublication);
  }

  /**
   * POST /v1/publications/:id/retry — 채널 단위 재시도. failed→queued CAS + (content가 publish_failed면
   * publish_failed→publishing) 후 그 1채널만 재큐(채널행 재패킹 — mock 결정적 성공/실패 반영).
   */
  async retryPublication(pubId: string, user: User): Promise<Publication> {
    const pub = await this.loadPublication(pubId);
    this.requireCenterActor(user);
    if (pub.status !== 'failed') {
      throw new DomainException('conflict', '재시도 가능한 상태가 아닙니다: failed 필요', {
        status: pub.status,
      });
    }
    const content = pub.contentId ? await this.loadContent(pub.contentId) : null;

    await this.prisma.$transaction(async (tx) => {
      const ok = await this.publications.retryToQueued(tx, pub.id, 'failed');
      if (!ok) {
        throw new DomainException('conflict', '동시 상태 변경 경합 — 재조회 후 재시도하세요', {
          publicationId: pub.id,
        });
      }
      if (content) await this.workflow.resumePublishing(tx, content, user);
    });

    // 커밋 후 재큐 — 그 1채널만(채널행 재패킹). content는 publishing으로 재조회.
    if (content) {
      const requeued = await this.publications.findById(pub.id);
      const publishing = await this.loadContent(content.id);
      await this.producer.enqueuePublish(publishing, requeued ? [requeued] : []);
    }

    return toPublication(await this.loadPublication(pubId));
  }

  /**
   * POST /v1/publications/:id/retract — 회수. published→retracted CAS. 목 어댑터 성공 후 상태 전이.
   * content 상태는 무변(채널 단위 회수 — shared 설계).
   */
  async retractPublication(pubId: string, user: User): Promise<Publication> {
    const pub = await this.loadPublication(pubId);
    this.requireCenterActor(user);
    if (pub.status !== 'published') {
      throw new DomainException('conflict', '회수 가능한 상태가 아닙니다: published 필요', {
        status: pub.status,
      });
    }
    const adapter = this.registry.get(pub.platform);
    if (!adapter) {
      throw new DomainException('conflict', `지원하지 않는 플랫폼: ${pub.platform}`);
    }
    const ch = await this.channels.findById(pub.channelAccountId);
    await adapter.retract({
      externalChannelId: ch?.externalChannelId ?? '',
      externalPostId: pub.externalPostId ?? '',
      credentialRef: ch?.credentialRef ?? '',
    });

    await this.prisma.$transaction(async (tx) => {
      const ok = await this.publications.retract(tx, pub.id);
      if (!ok) {
        throw new DomainException('conflict', '동시 상태 변경 경합 — 재조회 후 재시도하세요', {
          publicationId: pub.id,
        });
      }
    });

    return toPublication(await this.loadPublication(pubId));
  }

  // ── 내부 ──────────────────────────────────────────────

  private async loadContent(contentId: string): Promise<ContentRow> {
    const row = await this.prisma.content.findUnique({ where: { id: contentId } });
    if (!row) throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    return row;
  }

  private async loadPublication(pubId: string): Promise<PublicationRow> {
    const row = await this.publications.findById(pubId);
    if (!row) throw new DomainException('not_found', '송출 기록을 찾을 수 없습니다');
    return row;
  }

  private requireCenterActor(user: User): void {
    if (user.role !== 'center_operator' && user.role !== 'admin') {
      throw new DomainException('forbidden', '센터 운영자 또는 관리자만 수행할 수 있습니다');
    }
  }
}
