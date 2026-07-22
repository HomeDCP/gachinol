import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CursorPage, FeedItem, PlaybackInfo, StationSummary } from '@gachinol/shared';
import { Public } from '../common/decorators/public.decorator';
import { FeedService } from './feed.service';
import { FeedQueryDto } from './schemas/feed.schemas';

/**
 * 구독자 공개 피드 — 전부 @Public(완전 익명). @ApiBearerAuth·@Roles 미부착.
 * 토큰을 보내도 JwtAuthGuard가 무시하고 통과(req.user 미설정) → published만 노출.
 * (contents.controller.ts:29 "구독자 피드는 후속 별도 DTO"·stations.controller.ts:26의 후속)
 */
@ApiTags('feed')
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Public()
  @Get()
  @ApiOperation({ summary: '공개 피드 — published 콘텐츠 커서 목록 (익명)' })
  list(@Query() query: FeedQueryDto): Promise<CursorPage<FeedItem>> {
    return this.feed.list(query);
  }

  // 정적 세그먼트 — 동적 ':id/playback'보다 먼저 선언(라우트 모호성 제거)
  @Public()
  @Get('stations')
  @ApiOperation({ summary: '공개 지사 목록 — 운영·휴무 지사만 (익명)' })
  stations(): Promise<readonly StationSummary[]> {
    return this.feed.listPublicStations();
  }

  @Public()
  @Get(':id/playback')
  @ApiOperation({ summary: '재생 정보 — 서명 재생 URL·자막 (비published 404, 익명)' })
  playback(@Param('id') id: string): Promise<PlaybackInfo> {
    return this.feed.getPlayback(id);
  }
}
