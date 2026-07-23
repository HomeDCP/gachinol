import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  ChatMessage,
  LiveIngestInfo,
  LiveSession,
  Paginated,
  User,
} from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { ChatService } from './chat.service';
import { CommentCollectorService } from './comment-collector.service';
import { LiveSessionsService } from './live-sessions.service';
import { toChatMessage, toLiveSession } from './live.mapper';
import {
  CreateLiveSessionDto,
  HideChatDto,
  LiveLifecycleDto,
  LiveSessionListQueryDto,
} from './schemas/live.schemas';

/**
 * 센터 라이브 제어 — 생성·조회·라이프사이클·ingest·채팅 모더레이션.
 * 전이는 shared LIVE_SESSION_STATUS_TRANSITIONS + CAS(LiveSessionsService). start/end/cancel은
 * 댓글 수집기 arm/disarm을 함께 트리거(서비스↔수집기 순환 회피 위해 컨트롤러가 조합).
 */
@ApiTags('live-sessions')
@ApiBearerAuth()
@Controller('live-sessions')
export class LiveSessionsController {
  constructor(
    private readonly sessions: LiveSessionsService,
    private readonly collector: CommentCollectorService,
    private readonly chat: ChatService,
  ) {}

  @Post()
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '라이브 생성 — 불변식 type=emergency ⇔ scheduledAt=null' })
  async create(@CurrentUser() user: User, @Body() dto: CreateLiveSessionDto): Promise<LiveSession> {
    return toLiveSession(await this.sessions.create(dto, user));
  }

  @Get()
  @Roles('center_operator', 'announcer', 'admin')
  @ApiOperation({ summary: '라이브 목록 — status/type/hostStationId 필터, offset 페이지' })
  async list(@Query() query: LiveSessionListQueryDto): Promise<Paginated<LiveSession>> {
    const page = await this.sessions.list(query);
    return { ...page, items: page.items.map(toLiveSession) };
  }

  @Get(':id')
  @Roles('center_operator', 'announcer', 'admin')
  @ApiOperation({ summary: '라이브 상세' })
  async get(@Param('id') id: string): Promise<LiveSession> {
    return toLiveSession(await this.sessions.loadOr404(id));
  }

  @Get(':id/ingest')
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: 'ingest 정보 — streamKey 실값이 실리는 유일한 엔드포인트' })
  getIngest(@Param('id') id: string): Promise<LiveIngestInfo> {
    return this.sessions.getIngest(id);
  }

  @Post(':id/prepare')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: 'scheduled→preparing (rtmpIngestUrl·streamKeyRef 발급)' })
  async prepare(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _body: LiveLifecycleDto,
  ): Promise<LiveSession> {
    return toLiveSession(await this.sessions.prepare(id, user));
  }

  @Post(':id/start')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: 'preparing→live (startedAt·hlsPlaybackUrl + 댓글수집 arm)' })
  async start(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _body: LiveLifecycleDto,
  ): Promise<LiveSession> {
    const row = await this.sessions.start(id, user);
    this.collector.arm(id);
    return toLiveSession(row);
  }

  @Post(':id/interrupt')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: 'live→interrupted' })
  async interrupt(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _body: LiveLifecycleDto,
  ): Promise<LiveSession> {
    return toLiveSession(await this.sessions.interrupt(id, user));
  }

  @Post(':id/resume')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: 'interrupted→live' })
  async resume(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _body: LiveLifecycleDto,
  ): Promise<LiveSession> {
    return toLiveSession(await this.sessions.resume(id, user));
  }

  @Post(':id/end')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '{live,interrupted}→ended (endedAt + 댓글수집 disarm)' })
  async end(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _body: LiveLifecycleDto,
  ): Promise<LiveSession> {
    const row = await this.sessions.end(id, user);
    this.collector.disarm(id);
    return toLiveSession(row);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '{scheduled,preparing}→canceled (댓글수집 disarm)' })
  async cancel(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _body: LiveLifecycleDto,
  ): Promise<LiveSession> {
    const row = await this.sessions.cancel(id, user);
    this.collector.disarm(id);
    return toLiveSession(row);
  }

  @Post(':id/chat/:messageId/hide')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '채팅 숨김 — visibility=hidden + chat.moderated 브로드캐스트' })
  async hideChat(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() _body: HideChatDto,
  ): Promise<ChatMessage> {
    return toChatMessage(await this.chat.hide(id, messageId, user));
  }
}
