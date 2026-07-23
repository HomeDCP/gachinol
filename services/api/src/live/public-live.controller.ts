import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { LiveSessionPublic } from '@gachinol/shared';
import { Public } from '../common/decorators/public.decorator';
import { LiveBroadcaster } from './live.broadcaster';
import { LiveSessionsService } from './live-sessions.service';
import { toLiveSessionPublic } from './live.mapper';

/**
 * 구독자 공개 라이브 — 전부 @Public(완전 익명). 화이트리스트 투영(streamKeyRef·rtmpIngestUrl 등 차단).
 * status ∈ {scheduled,preparing,live,interrupted}만. viewerCount는 게이트웨이 프레즌스(미가용 시 0).
 */
@ApiTags('live')
@Controller('live')
export class PublicLiveController {
  constructor(
    private readonly sessions: LiveSessionsService,
    private readonly broadcaster: LiveBroadcaster,
  ) {}

  @Public()
  @Get('sessions')
  @ApiOperation({ summary: '공개 라이브 목록 — 예정·준비·방송중·일시중단 (익명)' })
  async list(): Promise<readonly LiveSessionPublic[]> {
    const rows = await this.sessions.listPublic();
    return rows.map((r) => toLiveSessionPublic(r, this.broadcaster.viewerCount(r.id)));
  }

  @Public()
  @Get('sessions/:id')
  @ApiOperation({ summary: '공개 라이브 상세 — 종료·취소는 404 (익명)' })
  async get(@Param('id') id: string): Promise<LiveSessionPublic> {
    const row = await this.sessions.getPublicOr404(id);
    return toLiveSessionPublic(row, this.broadcaster.viewerCount(id));
  }
}
