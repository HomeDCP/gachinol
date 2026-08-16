import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Paginated, User } from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  ResidentReviewsService,
  type ResidentUploadReviewItem,
} from './resident-reviews.service';
import { ResidentReviewQueryDto } from './schemas/resident-review.schemas';

/**
 * 주민 업로드 검수 — **전부 인증 표면**(무인증 표면은 `ResidentLinksController`가 따로 소유).
 *
 * ── 왜 별도 경로(`/v1/resident-uploads`)인가 ─────────────────────────────────
 * `/v1/resident-links/:token`이 이미 `@Public`으로 열려 있어, 같은 컨트롤러에 인증 라우트를 더하면
 * 선언 순서에 따라 `:token`이 먹느냐 마느냐가 갈리는 취약한 배치가 된다. 검수의 자원은 링크가 아니라
 * **업로드 1건**이므로 자원 경로 자체를 분리한다.
 *
 * ── 왜 `@Roles('reporter','admin')`인가 ─────────────────────────────────────
 * 03 §C-5의 검수 주체는 **지사 담당자**이고, 이 리포에서 지사 소속 사용자는 `reporter` role이다
 * (`center_operator`는 센터 소속이라 지사 검수 주체가 아니다). 링크를 **발급**하는 엔드포인트
 * (`POST /v1/resident-links`, T-W2-08)가 같은 이유로 `@Roles('reporter','admin')`이므로,
 * "발급한 사람이 검수한다"는 권한 표면이 정확히 일치한다. admin은 RolesGuard의 수퍼롤이라 어차피
 * 통과하지만 T-W2-08과 같은 형태로 명시한다(암묵 통과를 문서화된 통과로).
 * 지사 경계(자기 지사만) 강제는 서비스 계층 몫이다 — RolesGuard는 role만 본다.
 */
@ApiTags('resident-links')
@ApiBearerAuth()
@Controller('resident-uploads')
export class ResidentReviewsController {
  constructor(private readonly reviews: ResidentReviewsService) {}

  @Get()
  @Roles('reporter', 'admin')
  @ApiOperation({
    summary: '검수 대기열 조회 (지사 담당자) — 기자는 자기 지사만',
    description:
      '기본 status=awaiting_branch_review. 07 §3-15로 수집한 업로더 연락처·이용허락 동의 시각이 ' +
      '이 응답에만 실린다(무인증 표면에는 노출되지 않는다). stationId 필터는 admin 전용이며 ' +
      '기자에게는 서버가 소속 지사로 덮어쓴다.',
  })
  list(
    @CurrentUser() user: User,
    @Query() query: ResidentReviewQueryDto,
  ): Promise<Paginated<ResidentUploadReviewItem>> {
    return this.reviews.listQueue(user, query);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('reporter', 'admin')
  @ApiOperation({
    summary: '검수 승인 → 정식 파이프라인 진입 (03 §C-5)',
    description:
      'resident_uploads.status=approved + 검수자·시각 기록 후 트랜스코딩 잡을 인큐한다(인큐-애프터-커밋). ' +
      '멱등이며, 잡이 유실된 건은 같은 호출로 재인큐된다. Redis 미설정 시에는 승인 자체를 거부한다 ' +
      '(승인만 기록되고 처리되지 않는 교착 방지).',
  })
  approve(
    @CurrentUser() user: User,
    @Param('id') id: string,
  ): Promise<ResidentUploadReviewItem> {
    return this.reviews.approve(user, id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  @Roles('reporter', 'admin')
  @ApiOperation({
    summary: '검수 반려 [종결] — 파이프라인 미진입 확정',
    description:
      '07 §3-15 "불법촬영물 의심 시 즉시 반려" 대응. 사유 바디는 받지 않는다(저장할 컬럼이 없어 ' +
      '받아도 버려진다 — 사유 보존은 후속 위임). 인큐하지 않으며 큐 가용성도 요구하지 않는다.',
  })
  reject(@CurrentUser() user: User, @Param('id') id: string): Promise<ResidentUploadReviewItem> {
    return this.reviews.reject(user, id);
  }
}
