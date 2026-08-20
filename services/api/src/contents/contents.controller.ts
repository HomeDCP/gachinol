import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
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
  UpdateContentCaptionsDto,
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
  @ApiOperation({
    summary: '목록 — reporter는 자기 지사 강제',
    description:
      'minorConsent=pending|confirmed는 미성년자 동의 게이트 필터다(T-W2-27, 대장 #118). 둘 다 ' +
      'hasMinorSubject=true인 콘텐츠만 남기며, pending은 아직 확인되지 않은 것 = 센터가 확인해야 ' +
      '승인이 풀리는 대기열이다. status로 대체할 수 없다 — reviewPolicy=reporter_only는 센터 검토를 ' +
      '거치지 않아 차단된 콘텐츠가 awaiting_reporter_review에 멈추기 때문이다. 사실 필터라 ' +
      '종결(rejected·canceled) 상태를 따로 제외하지 않는다. 응답 ContentSummary에도 ' +
      'hasMinorSubject·minorConsentConfirmedAt이 실린다(확인자 id는 상세에만). ' +
      'captions=needed는 자막 대기열 필터다(T-W2-34, 대장 #123) — 간단 모드·주민 제보로 ' +
      '자막 없이(scenes=[]) 들어온 콘텐츠 중 **아직 채울 수 있는 것**만 남긴다. ' +
      'minorConsent와 달리 순수 사실 필터가 아니다: 상태 조건(published 이후·종결 제외)을 ' +
      '값 자체가 포함하며, 그 판정은 자막 쓰기 게이트(PATCH :id/captions)와 같은 shared ' +
      '원천에서 파생해 둘이 어긋날 수 없다. status와 함께 보내면 AND로 적용된다.',
  })
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
  @ApiOperation({
    summary: '초안 수정 — draft·revision_requested만 + 담당 기자 본인. 센터·관리자는 송출처만',
    description:
      '업로드 이후에는 이 경로가 닫힌다. 자막만 사후에 채우려면 PATCH :id/captions를 쓴다 ' +
      '(더 넓은 상태 범위 + 같은 지사 기자 — T-W2-34).',
  })
  update(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateContentDraftDto,
  ): Promise<Content> {
    return this.contents.update(user, id, body);
  }

  @Patch(':id/captions')
  @Roles('reporter', 'center_operator')
  @ApiOperation({
    summary: '사후 자막 보강 — 같은 지사 기자까지 허용, published 전까지 (T-W2-34, 대장 #123)',
    description:
      '간단 모드(03 §C-4)는 촬영자에게서 자막 부담을 걷어내고 자막 없이(scenes=[]) 업로드한다. ' +
      '자막은 나중에 지사 담당자가 이 경로로 채운다. 초안 수정(PATCH /v1/contents/:id)과 ' +
      '일부러 분리했다 — 그쪽은 draft·revision_requested + 담당 기자 본인이지만, 여기는 ' +
      'published 직전까지의 모든 상태(shared CAPTION_EDITABLE_CONTENT_STATUSES = 전이맵 파생 ' +
      '비종결 − published) + 같은 지사 기자다. 넓힌 액터가 제목·분류를 못 고치도록 바디에 ' +
      'scenes만 둔다. scenes는 전량 치환이며 order 기준으로 기존 SceneId를 보존 병합한다 ' +
      '(수정 지시 sceneNotes의 참조 유지). 빈 배열은 자막 전량 삭제. ' +
      '타 지사 기자 403 · 송출(published) 이후·종결 상태 409(details.status). ' +
      '승인·송출은 자막 유무로 막지 않는다(사용자 결정 2026-08-16 "송출 허용 + 사후 보강").',
  })
  updateCaptions(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: UpdateContentCaptionsDto,
  ): Promise<Content> {
    return this.contents.updateCaptions(user, id, body);
  }

  @Post(':id/minor-consent')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({
    summary: '미성년자 피촬영자 법정대리인 동의 확인 — 센터 전용 (07 §3-3·02 §E-20, T-W2-23)',
    description:
      '촬영한 기자가 아니라 검토하는 센터가 확인해야 게이트가 실효를 갖는다. hasMinorSubject=false인 ' +
      '콘텐츠는 거부(선확인 후 플래그를 켜는 우회 차단). 이미 확인된 콘텐츠는 멱등 200이며 최초 ' +
      '확인자·시각을 덮어쓰지 않는다(감사 기록 보존).',
  })
  confirmMinorConsent(@CurrentUser() user: User, @Param('id') id: string): Promise<Content> {
    return this.contents.confirmMinorConsent(user, id);
  }

  @Delete(':id/minor-consent')
  @Roles('center_operator', 'admin')
  @ApiOperation({
    summary: '미성년자 동의 확인 철회 — 센터 전용',
    description:
      '미확인 상태면 409. 미성년자 게이트가 차단하는 전이(reviewPolicy에 따라 ' +
      'awaiting_center_review→center_approved 또는 awaiting_reporter_review→reporter_approved)가 ' +
      'status_transition_logs에 이미 기록됐으면 게이트 효력이 없어 409로 거부한다. approvedAt은 ' +
      '판정에 쓰지 않는다(reporter_then_center의 기자 승인 hop에서도 채워지므로 게이트 통과의 ' +
      '프록시가 아니다). 사유 바디는 받지 않는다(저장할 컬럼이 없다 — T-W2-24 선례).',
  })
  withdrawMinorConsent(@CurrentUser() user: User, @Param('id') id: string): Promise<Content> {
    return this.contents.withdrawMinorConsent(user, id);
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

  @Post(':id/regenerate')
  @HttpCode(200)
  @Roles('reporter', 'center_operator')
  @ApiOperation({
    summary: '재생성 시작 — revision_requested→regenerating. 초안을 고친 뒤 누른다',
    description:
      '수정 요청과 자동 연쇄하지 않는다: revision_requested는 초안 수정이 허용되는 상태라 ' +
      '자동으로 재생성하면 자막을 고칠 기회가 사라진다. 커밋 후 auto_edit 잡을 인큐한다.',
  })
  async regenerate(@CurrentUser() user: User, @Param('id') id: string): Promise<Content> {
    const updated = await this.workflow.regenerate(id, user);
    // 인큐-애프터-커밋. Redis 미설정 시 무동작(상태는 regenerating으로 남고 센터가 재시도 가능).
    await this.producer.enqueueAutoEdit(updated);
    return toContent(updated);
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
