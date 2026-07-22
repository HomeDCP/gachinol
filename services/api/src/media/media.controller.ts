import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { MediaAccessUrl, User } from '@gachinol/shared';
import { isReporterUser } from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { MediaAssetsService } from './media-assets.service';
import { S3Service } from './s3.service';

/** 서명 URL 발급 — 기자 프리뷰 재생·상세 확인 루프 완결용 (미디어 바이트는 api를 거치지 않음) */
@ApiTags('media-assets')
@ApiBearerAuth()
@Controller('media-assets')
export class MediaController {
  constructor(
    private readonly assets: MediaAssetsService,
    private readonly s3: S3Service,
    private readonly prisma: PrismaService,
  ) {}

  @Get(':id/url')
  @Roles('reporter', 'center_operator', 'admin')
  @ApiOperation({ summary: '미디어 자산 서명 GET URL — reporter는 자기 지사, 센터·관리자는 전체' })
  async getUrl(@CurrentUser() user: User, @Param('id') id: string): Promise<MediaAccessUrl> {
    const asset = await this.assets.findById(id);
    if (!asset) throw new DomainException('not_found', '미디어 자산을 찾을 수 없습니다');

    // 읽기 범위 — reporter는 소속 지사 콘텐츠만 (contents loadReadable 범위와 동일)
    if (isReporterUser(user)) {
      const content = asset.contentId
        ? await this.prisma.content.findUnique({ where: { id: asset.contentId } })
        : null;
      if (!content || content.stationId !== user.stationId) {
        throw new DomainException('forbidden', '자기 지사 콘텐츠의 자산만 조회할 수 있습니다');
      }
    }

    return this.s3.presignGet(asset.storageKey);
  }
}
