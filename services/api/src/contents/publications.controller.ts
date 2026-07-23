import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Publication, User } from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  RetractPublicationDto,
  RetryPublicationDto,
} from '../distribution/schemas/publication.schemas';
import { DistributionOrchestratorService } from './distribution-orchestrator.service';

/** 채널 단위 송출 재시도·회수 — 센터 전용. content 전이를 요하므로 ContentsModule 소속(순환 없음). */
@ApiTags('publications')
@ApiBearerAuth()
@Controller('publications')
export class PublicationsController {
  constructor(private readonly distribution: DistributionOrchestratorService) {}

  @Post(':id/retry')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '채널 단위 재시도 — failed→queued 재큐' })
  retry(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _body: RetryPublicationDto,
  ): Promise<Publication> {
    return this.distribution.retryPublication(id, user);
  }

  @Post(':id/retract')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '회수 — published→retracted (목 어댑터 성공)' })
  retract(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() _body: RetractPublicationDto,
  ): Promise<Publication> {
    return this.distribution.retractPublication(id, user);
  }
}
