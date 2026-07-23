import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  Paginated,
  RecommendationReview,
  User,
  WeeklyRecommendation,
} from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import { RecommendationsService } from './recommendations.service';
import {
  GenerateRecommendationDto,
  RecommendationListQueryDto,
  RequestRecommendationRevisionDto,
} from './schemas/recommendation.schemas';

/**
 * 주간 콘텐츠 추천 — 센터 전용(관제 앱). 기자·구독자는 전 엔드포인트 403.
 * 범용 transition 엔드포인트 없음 — 각 전이는 전용 진입점으로만 도달한다.
 */
@ApiTags('recommendations')
@ApiBearerAuth()
@Controller('recommendations')
export class RecommendationsController {
  constructor(private readonly recommendations: RecommendationsService) {}

  @Post()
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({
    summary: '주간 추천 생성 — weekOf는 서버가 그 주 월요일(KST)로 정규화. 주 1건 멱등',
  })
  generate(
    @CurrentUser() user: User,
    @Body() body: GenerateRecommendationDto,
  ): Promise<WeeklyRecommendation> {
    return this.recommendations.generate(user, body);
  }

  @Get()
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '주차 목록 (weekOf 내림차순)' })
  list(
    @CurrentUser() _user: User,
    @Query() query: RecommendationListQueryDto,
  ): Promise<Paginated<WeeklyRecommendation>> {
    return this.recommendations.list(query);
  }

  @Get(':id')
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '검토 화면 — items를 rank순 ContentSummary로 조인' })
  detail(@CurrentUser() _user: User, @Param('id') id: string): Promise<RecommendationReview> {
    return this.recommendations.getReview(id);
  }

  @Post(':id/approve')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '승인 — pending_review→approved (송출 배선은 후속)' })
  approve(@CurrentUser() user: User, @Param('id') id: string): Promise<WeeklyRecommendation> {
    return this.recommendations.approve(id, user);
  }

  @Post(':id/request-revision')
  @HttpCode(200)
  @Roles('center_operator', 'admin')
  @ApiOperation({ summary: '수정 요청 — revision_requested→regenerating 자동 연쇄(gen+1)' })
  requestRevision(
    @CurrentUser() user: User,
    @Param('id') id: string,
    @Body() body: RequestRecommendationRevisionDto,
  ): Promise<WeeklyRecommendation> {
    return this.recommendations.requestRevision(id, user, body);
  }
}
