import { Body, Controller, Get, HttpCode, Logger, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Content,
  ContentDetail,
  ContentSummary,
  Paginated,
  Publication,
  StatusTransitionLog,
  User,
} from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { AnalysisProducerService } from '../analysis/analysis-producer.service';
import { DistributionProducerService } from '../distribution/distribution-producer.service';
import { QueueProducerService } from '../queue/queue-producer.service';
import { toContent } from './content.mapper';
import { ContentWorkflowService } from './content-workflow.service';
import { ContentsService } from './contents.service';
import { DistributionOrchestratorService } from './distribution-orchestrator.service';
import {
  CancelContentDto,
  ContentListQueryDto,
  CreateContentDraftDto,
  CreateRevisionRequestDto,
  DistributeContentDto,
  PageQueryDto,
  RejectContentDto,
  TransitionContentDto,
  UpdateContentDraftDto,
} from './schemas/content.schemas';

/** subscriber는 contents API 전체 403 — 구독자 피드는 후속 별도 DTO */
@ApiTags('contents')
@ApiBearerAuth()
@Controller('contents')
export class ContentsController {
  private readonly logger = new Logger(ContentsController.name);

  constructor(
    private readonly contents: ContentsService,
    private readonly workflow: ContentWorkflowService,
    private readonly producer: QueueProducerService,
    private readonly analysisProducer: AnalysisProducerService,
    private readonly distributionProducer: DistributionProducerService,
    private readonly distribution: DistributionOrchestratorService,
  ) {}

  @Post()
  @Roles('reporter')
  @ApiOperation({ summary: '초안 생성 — stationId·reporterId는 토큰에서 (바디 수신 금지)' })
  create(@CurrentUser() user: User, @Body() body: CreateContentDraftDto): Promise<Content> {
    return this.contents.createDraft(user, body);
  }

  @Get()
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '목록 — reporter는 자기 지사 강제' })
  list(
    @CurrentUser() user: User,
    @Query() query: ContentListQueryDto,
  ): Promise<Paginated<ContentSummary>> {
    return this.contents.list(user, query);
  }

  @Get(':id')
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '상세 (assets·analysis·publications는 해당 테이블 도입 단계에서 채움)' })
  detail(@CurrentUser() user: User, @Param('id') id: string): Promise<ContentDetail> {
    return this.contents.getDetail(user, id);
  }

  @Patch(':id')
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '초안 수정 — draft·revision_requested만. 센터·관리자는 송출처만' })
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateContentDraftDto,
  ): Promise<Content> {
    return this.contents.update(user, id, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({
    summary: '승인 — 기자: reporter_approved 후 reviewPolicy 자동 연쇄 / 센터: center_approved',
  })
  async approve(@CurrentUser() user: User, @Param('id') id: string): Promise<Content> {
    const updated = await this.workflow.approve(id, user);
    // reporter_only(afterReporterApproval): reporter_approved→publishing 자동 연쇄 시 자동 송출 트리거.
    // 센터 승인(awaiting_center_review→center_approved)은 status가 publishing이 아니라 미해당 → 이중 송출 없음.
    // 에러 격리: 자동 송출 실패가 승인 200 응답을 깨지 않게 한다(Publication은 인큐-애프터-커밋으로 이미 커밋 →
    // 채널 단위 retry로 복구 가능). 실 채널 송출은 orchestrator가 커밋 후 인큐.
    if (updated.status === 'publishing') {
      try {
        await this.distribution.startAutoDistribution(updated, user);
      } catch (e) {
        this.logger.error(
          `reporter_only 자동 송출 실패(승인은 유지) contentId=${id}: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    return toContent(updated);
  }

  @Post(':id/request-revision')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '수정 요청 — RevisionRequest 생성과 동일 트랜잭션' })
  async requestRevision(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: CreateRevisionRequestDto,
  ): Promise<Content> {
    return toContent(await this.workflow.requestRevision(id, user, body));
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '반려 [종결] — 사유 필수. 재작업은 새 콘텐츠 + remakeOfContentId' })
  async reject(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: RejectContentDto,
  ): Promise<Content> {
    return toContent(await this.workflow.reject(id, user, body.note));
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '취소 [종결] — 전이 맵상 canceled 가능 상태 전부' })
  async cancel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: CancelContentDto,
  ): Promise<Content> {
    return toContent(await this.workflow.cancel(id, user, body.note));
  }

  @Post(':id/retry')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '실패 재시도 — 목적지는 shared CONTENT_RETRY_TARGET' })
  async retry(@CurrentUser() user: User, @Param('id') id: string): Promise<Content> {
    const updated = await this.workflow.retry(id, user);
    // 인큐-애프터-커밋 — 해당 실패 복귀 상태의 잡 재큐(Redis 미설정 시 무동작).
    // media(processing/preview_generating)·analysis(analyzing)·distribution(publishing) 생산자는
    // 자기 상태만 처리·그 외 no-op이라 안전 병존.
    await this.producer.requeueForStatus(updated);
    await this.analysisProducer.requeueForStatus(updated);
    await this.distributionProducer.requeueForStatus(updated);
    return toContent(updated);
  }

  @Post(':id/distribute')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({
    summary: '다채널 송출 — center_approved만. 대상 채널 override 가능(생략 시 서버 해석)',
  })
  distribute(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: DistributeContentDto,
  ): Promise<readonly Publication[]> {
    return this.distribution.distribute(id, user, body);
  }

  @Get(':id/publications')
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '채널별 송출 상태 (최신순)' })
  listPublications(
    @CurrentUser() _user: User,
    @Param('id') id: string,
  ): Promise<readonly Publication[]> {
    return this.distribution.listForContent(id);
  }

  @Post(':id/transitions')
  @HttpCode(200)
  @Roles('admin', 'center_operator')
  @ApiOperation({ summary: '범용 전이 — 워커 부재 기간 파이프라인 수동 진행·운영 복구' })
  async transition(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: TransitionContentDto,
  ): Promise<Content> {
    return toContent(await this.workflow.transition(id, body.toStatus, user, body.note));
  }

  @Get(':id/transition-logs')
  @Roles('reporter', 'center_operator')
  @ApiOperation({ summary: '전이 이력 (최신순)' })
  transitionLogs(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Query() query: PageQueryDto,
  ): Promise<Paginated<StatusTransitionLog>> {
    return this.contents.transitionLogs(user, id, query);
  }
}
