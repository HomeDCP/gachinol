import { Injectable } from '@nestjs/common';
import type {
  Content,
  ContentDetail,
  ContentSummary,
  Paginated,
  Scene,
  SceneId,
  StatusTransitionLog,
  User,
} from '@gachinol/shared';
import { isReporterUser, requiresCultureTopic } from '@gachinol/shared';
import type { Content as ContentRow } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { DomainException } from '../common/errors/domain.exception';
import { newId } from '../common/ids';
import { toPaginated, toSkipTake } from '../common/pagination/pagination.util';
import type { PageParams } from '../common/pagination/pagination.util';
import { REVIEW_POLICY_DEFAULTS } from '../config/review-policy.config';
import { MediaAssetsService } from '../media/media-assets.service';
import { toMediaAsset } from '../media/media-asset.mapper';
import { PrismaService } from '../prisma/prisma.service';
import {
  toContent,
  toContentDetail,
  toContentSummary,
  toStatusTransitionLog,
} from './content.mapper';
import { zScene } from './schemas/content.schemas';
import type {
  ContentListQueryDto,
  CreateContentDraftDto,
  UpdateContentDraftDto,
} from './schemas/content.schemas';

/** draft 수정이 허용되는 상태 (shared dto 주석의 서버 검증) */
const EDITABLE_STATUSES = ['draft', 'revision_requested'] as const;

@Injectable()
export class ContentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: MediaAssetsService,
  ) {}

  /**
   * 초안 생성 — stationId·reporterId는 토큰에서(바디 수신 금지), origin='reporter_upload',
   * status='draft', generation=1, priority는 emergency→urgent, reviewPolicy는 서버 기본 매핑.
   */
  async createDraft(user: User, dto: CreateContentDraftDto): Promise<Content> {
    if (!isReporterUser(user)) {
      // admin 수퍼롤이 RolesGuard를 통과해도 초안 생성은 담당 기자 불변식상 기자만
      throw new DomainException('forbidden', '콘텐츠 초안 생성은 기자만 가능합니다');
    }

    const scenes: Scene[] = dto.scenes.map((s) => ({ ...s, id: newId<SceneId>() }));
    const row = await this.prisma.content.create({
      data: {
        id: newId(),
        stationId: user.stationId,
        origin: 'reporter_upload',
        reporterId: user.id,
        title: dto.title,
        description: dto.description ?? null,
        category: dto.category,
        cultureTopics: dto.cultureTopics ?? [],
        status: 'draft',
        priority: dto.category === 'emergency' ? 'urgent' : 'normal',
        reviewPolicy: REVIEW_POLICY_DEFAULTS[dto.category],
        generation: 1,
        scenes: scenes as unknown as Prisma.InputJsonValue,
        // channel_accounts 도입 시 "소속 지사 kakao 채널" 기본 규칙 활성화
        targetChannelAccountIds: [],
        tags: [],
      },
    });
    return toContent(row);
  }

  async list(user: User, query: ContentListQueryDto): Promise<Paginated<ContentSummary>> {
    // reporter는 쿼리 stationId를 서버가 자기 소속으로 덮어씀
    const stationId = isReporterUser(user) ? user.stationId : query.stationId;
    const where: Prisma.ContentWhereInput = {
      ...(stationId ? { stationId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.category ? { category: query.category } : {}),
    };
    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.content.count({ where }),
      this.prisma.content.findMany({
        where,
        include: { station: { select: { name: true } }, reporter: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        ...toSkipTake(query),
      }),
    ]);
    return toPaginated(rows.map(toContentSummary), totalCount, query);
  }

  async getDetail(user: User, id: string): Promise<ContentDetail> {
    const row = await this.loadReadable(user, id);
    const revisions = await this.prisma.revisionRequest.findMany({
      where: { contentId: id },
      orderBy: { createdAt: 'desc' },
    });
    // 현 세대 산출물 (미업로드면 행 0 → assets:[])
    const assetRows = await this.assets.listForContent(id, row.generation);
    return toContentDetail(row, revisions, assetRows.map(toMediaAsset));
  }

  /** 소유 reporter는 전체 필드, center_operator·admin은 targetChannelAccountIds만 */
  async update(user: User, id: string, dto: UpdateContentDraftDto): Promise<Content> {
    const row = await this.loadOwned(user, id);

    if (!(EDITABLE_STATUSES as readonly string[]).includes(row.status)) {
      throw new DomainException(
        'conflict',
        'draft·revision_requested 상태에서만 수정할 수 있습니다',
        {
          status: row.status,
        },
      );
    }

    if (!isReporterUser(user)) {
      const touchesDraftFields =
        dto.title !== undefined ||
        dto.description !== undefined ||
        dto.category !== undefined ||
        dto.cultureTopics !== undefined ||
        dto.scenes !== undefined;
      if (touchesDraftFields) {
        throw new DomainException(
          'forbidden',
          '센터·관리자는 targetChannelAccountIds만 수정할 수 있습니다',
        );
      }
    }

    // culture↔cultureTopics 상호 불변식 — 병합 결과 기준 (shared 순수 헬퍼가 원천).
    // 검증에 쓴 병합값을 그대로 저장한다: culture 유지 시 기존 topics 보존,
    // culture 밖으로 나가면 암묵적으로 [] (명시 전송 불요).
    const category = dto.category ?? (row.category as Content['category']);
    const cultureTopics: Content['cultureTopics'] = requiresCultureTopic(category)
      ? (dto.cultureTopics ?? (row.cultureTopics as Content['cultureTopics']))
      : (dto.cultureTopics ?? []);
    if (requiresCultureTopic(category) && !cultureTopics?.length) {
      throw new DomainException(
        'validation_failed',
        "category='culture'는 cultureTopics 1개 이상 필수",
      );
    }
    if (!requiresCultureTopic(category) && cultureTopics?.length) {
      throw new DomainException('validation_failed', 'culture 외 분류는 cultureTopics 금지');
    }

    const data: Prisma.ContentUpdateInput = {
      ...(dto.title !== undefined ? { title: dto.title } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.category !== undefined || dto.cultureTopics !== undefined
        ? { category, cultureTopics: [...(cultureTopics ?? [])] } // 검증한 병합값 그대로 저장
        : {}),
      ...(dto.targetChannelAccountIds !== undefined
        ? { targetChannelAccountIds: [...dto.targetChannelAccountIds] }
        : {}),
    };
    if (dto.scenes !== undefined) {
      data.scenes = this.mergeScenes(row, dto.scenes) as unknown as Prisma.InputJsonValue;
    }

    const updated = await this.prisma.content.update({ where: { id }, data });
    return toContent(updated);
  }

  async transitionLogs(
    user: User,
    id: string,
    page: PageParams,
  ): Promise<Paginated<StatusTransitionLog>> {
    await this.loadReadable(user, id); // 존재+읽기 범위 확인
    const where: Prisma.StatusTransitionLogWhereInput = { entityType: 'content', entityId: id };
    const [totalCount, rows] = await this.prisma.$transaction([
      this.prisma.statusTransitionLog.count({ where }),
      this.prisma.statusTransitionLog.findMany({
        where,
        orderBy: { at: 'desc' },
        ...toSkipTake(page),
      }),
    ]);
    return toPaginated(rows.map(toStatusTransitionLog), totalCount, page);
  }

  /** 존재 확인 + 소유권 (기자=자기 담당만, center_operator·admin 전체) — 위반 403. 쓰기 경로용 */
  async loadOwned(user: User, id: string): Promise<ContentRow> {
    const row = await this.prisma.content.findUnique({ where: { id } });
    if (!row) throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    if (isReporterUser(user) && row.reporterId !== user.id) {
      throw new DomainException('forbidden', '자기 담당 콘텐츠만 접근할 수 있습니다');
    }
    return row;
  }

  /**
   * 존재 확인 + 읽기 범위 (기자=소속 지사 전체 — list()와 동일 범위, center_operator·admin 전체).
   * 목록에 보이는 항목은 상세·이력도 열려야 한다 (읽기 계약 정합). 쓰기·전이는 loadOwned 유지.
   */
  private async loadReadable(user: User, id: string): Promise<ContentRow> {
    const row = await this.prisma.content.findUnique({ where: { id } });
    if (!row) throw new DomainException('not_found', '콘텐츠를 찾을 수 없습니다');
    if (isReporterUser(user) && row.stationId !== user.stationId) {
      throw new DomainException('forbidden', '자기 지사 콘텐츠만 조회할 수 있습니다');
    }
    return row;
  }

  /**
   * SceneId 정책: order가 같으면 기존 id 보존, 신규 장면은 새 id —
   * RevisionRequest.sceneNotes의 sceneId 참조 안정성 (재발급하면 수정 지시가 유령 참조가 된다).
   */
  private mergeScenes(row: ContentRow, inputs: UpdateContentDraftDto['scenes']): Scene[] {
    const existing = zScene.array().parse(row.scenes);
    const byOrder = new Map(existing.map((s) => [s.order, s]));
    return (inputs ?? []).map((input) => ({
      ...input,
      id: byOrder.get(input.order)?.id ?? newId<SceneId>(),
    }));
  }
}
