import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@gachinol/shared';
import type { Request } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { Roles } from '../common/decorators/roles.decorator';
import {
  extractClientIp,
  TelemetryIpRateLimiter,
} from '../telemetry/telemetry-rate-limiter';
import {
  RESIDENT_UPLOAD_MAX_BYTES,
  RESIDENT_UPLOAD_RATE_LIMIT_CAPACITY,
  RESIDENT_UPLOAD_RATE_LIMIT_IDLE_TTL_MS,
  RESIDENT_UPLOAD_RATE_LIMIT_MAX_IPS,
  RESIDENT_UPLOAD_RATE_LIMIT_REFILL_MS,
  RESIDENT_UPLOAD_RATE_LIMIT_SWEEP_INTERVAL_MS,
} from './resident-links.constants';
import {
  ResidentLinksService,
  type IssuedResidentLink,
  type ResidentLinkPublicView,
  type ResidentUploadReceipt,
  type ResidentUploadTicket,
} from './resident-links.service';
import {
  IssueResidentLinkDto,
  ResidentUploadRequestDto,
} from './schemas/resident-link.schemas';

/**
 * 주민 임시 업로드 링크 — 발급 1종(인증) + 무인증 3종(02 §D-T9).
 *
 * 무인증 표면이라 응답은 전부 화이트리스트 투영이다(발급자·연락처·내부 id 미노출 — feed 모듈 원칙).
 * 인증이 없는 대신 **토큰(256비트 CSPRNG) 소지 = 권한**이며, 링크 자체가 72시간·5건으로 제한된다.
 */
@ApiTags('resident-links')
@Controller('resident-links')
export class ResidentLinksController {
  /**
   * 03 §C-5 "동일 IP 시간당 업로드 시도 10회 초과 시 차단".
   *
   * · **왜 429인가**: 정본 문언은 "차단"이라 코드를 특정하지 않는다. 한도 초과는 권한 문제(403)가
   *   아니라 "지금은 그만, 나중에 다시"라는 속도 문제이므로 429(Too Many Requests)를 쓴다 —
   *   같은 판단으로 이미 429를 쓰는 `TelemetryController`(대장 #79 조치④)와 표면을 통일한다.
   *   403은 이 모듈에서 **정책 위반**(만료·건수 소진·용량 초과, 02 §D-T9 명문)에만 쓴다.
   * · **왜 `uploads`에만 거는가**: 완료 통지(`.../complete`)의 비싼 경로(S3 HEAD·DB 쓰기)는 이
   *   레이트리밋을 통과해 발급받은 슬롯이 있어야만 도달한다. 유효 슬롯이 없으면 인덱스 조회 1회 후
   *   404로 끝나므로, 두 엔드포인트에 같은 버킷을 물리면 정직한 사용자만 절반의 예산을 잃는다.
   * · 인스턴스는 `TelemetryController`와 동형으로 컨트롤러가 프로세스 생애주기 동안 직접 보유한다
   *   (순수 클래스, DI 불요). IP 추출 신뢰 순위·한계는 `telemetry-rate-limiter.ts` 상단 주석이 원천.
   */
  private readonly rateLimiter = new TelemetryIpRateLimiter(
    RESIDENT_UPLOAD_RATE_LIMIT_CAPACITY,
    RESIDENT_UPLOAD_RATE_LIMIT_REFILL_MS,
    RESIDENT_UPLOAD_RATE_LIMIT_MAX_IPS,
    RESIDENT_UPLOAD_RATE_LIMIT_IDLE_TTL_MS,
    RESIDENT_UPLOAD_RATE_LIMIT_SWEEP_INTERVAL_MS,
  );

  constructor(private readonly residentLinks: ResidentLinksService) {}

  @Post()
  @ApiBearerAuth()
  @Roles('reporter', 'admin')
  @ApiOperation({
    summary: '주민 임시 업로드 링크 발급 (지사 담당자) — 토큰 원문은 이 응답에서 1회만 나온다',
    description:
      '유효기간 72시간·링크당 5건(03 §C-5). 기자는 자기 소속 지사로만 발급되고, admin은 stationId를 ' +
      '지정해야 한다. 서버는 토큰 해시만 보관하므로 분실 시 재조회가 불가능하다(재발급만 가능).',
  })
  issue(@CurrentUser() user: User, @Body() body: IssueResidentLinkDto): Promise<IssuedResidentLink> {
    return this.residentLinks.issue(user, body);
  }

  @Public()
  @Get(':token')
  @ApiOperation({
    summary: '링크 유효성 조회 (익명) — 축소 업로드 화면의 진입 게이트',
    description:
      '만료·건수 소진은 valid=false + reason으로 알린다(재발급 요청 안내를 위해). 형식 오류·미존재 ' +
      '토큰은 404로 수렴한다. 발급자·업로더 연락처·내부 id는 응답에 포함하지 않는다.',
  })
  describe(@Param('token') token: string): Promise<ResidentLinkPublicView> {
    return this.residentLinks.describe(token);
  }

  @Public()
  @Post(':token/uploads')
  @HttpCode(200)
  @ApiOperation({
    summary: 'presigned PUT 발급 (익명, IP 시간당 10회)',
    description:
      `건당 ${Math.floor(RESIDENT_UPLOAD_MAX_BYTES / 1024 / 1024)}MB 초과·링크당 5건 초과·만료는 403, ` +
      'IP 레이트리밋 초과는 429. 제목·분류·자막은 받지 않는다(간단 모드 강제 — 지사 담당자 사후 입력).',
  })
  createUpload(
    @Param('token') token: string,
    @Body() body: ResidentUploadRequestDto,
    @Req() req: Request,
  ): Promise<ResidentUploadTicket> {
    const { allowed, retryAfterMs } = this.rateLimiter.check(extractClientIp(req));
    if (!allowed) {
      throw new HttpException(
        `업로드 시도가 너무 많습니다. 약 ${Math.max(1, Math.ceil(retryAfterMs / 60000))}분 후 다시 시도해주세요.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return this.residentLinks.createUpload(token, body);
  }

  @Public()
  @Post(':token/uploads/:uploadId/complete')
  @HttpCode(200)
  @ApiOperation({
    summary: '업로드 완료 통지 (익명) — 지사 담당자 검수 대기열 편입',
    description:
      '★ 여기서 미디어 큐를 인큐하지 않는다: 검수 승인 전에는 정식 파이프라인에 진입하지 않는다' +
      '(03 §C-5). 재전송은 멱등이며, 오브젝트 부재는 400 + 소비된 건수 반환이다.',
  })
  complete(
    @Param('token') token: string,
    @Param('uploadId') uploadId: string,
  ): Promise<ResidentUploadReceipt> {
    return this.residentLinks.completeUpload(token, uploadId);
  }
}
