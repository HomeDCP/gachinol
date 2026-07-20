import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Content,
  ContentDetail,
  ContentSummary,
  Paginated,
  StatusTransitionLog,
  User,
} from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { toContent } from './content.mapper';
import { ContentWorkflowService } from './content-workflow.service';
import { ContentsService } from './contents.service';
import {
  CancelContentDto,
  ContentListQueryDto,
  CreateContentDraftDto,
  CreateRevisionRequestDto,
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
  constructor(
    private readonly contents: ContentsService,
    private readonly workflow: ContentWorkflowService,
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
    return toContent(await this.workflow.approve(id, user));
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
    return toContent(await this.workflow.retry(id, user));
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
