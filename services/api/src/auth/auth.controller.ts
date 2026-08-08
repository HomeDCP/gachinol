import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Logger,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthTokens, LoginResponse, RefreshTokenResponse, User } from '@gachinol/shared';
import type { Request, Response } from 'express';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { DomainException } from '../common/errors/domain.exception';
import type { Env } from '../config/env.schema';
import {
  AuthService,
  expiredRefreshCookies,
  hasCsrfHeader,
  isAllowedWebOrigin,
  isSecureCookieContext,
  readWebRefreshCookie,
  requestOrigin,
  serializeRefreshCookie,
  WEB_ORIGINS_ENV_KEY,
} from './auth.service';
import { LoginDto, LogoutDto, RefreshTokenDto } from './schemas/auth.schemas';

/**
 * 웹 세션 응답 — **refresh 원문은 바디에 넣지 않는다**(HttpOnly 쿠키 전용).
 * 바디로 한 번이라도 내보내면 JS가 읽을 수 있게 되어 쿠키로 옮긴 이유가 사라진다.
 * 그래서 shared `LoginResponse`(tokens에 refreshToken 포함)를 재사용하지 않고 웹 전용 형태를 둔다.
 */
export interface WebSessionResponse {
  accessToken: string;
  accessTokenExpiresAt: string;
  /** 세션 만료 UX용 — 토큰 원문이 아니라 만료 시각만 */
  refreshTokenExpiresAt: string;
}

export interface WebLoginResponse extends WebSessionResponse {
  user: User;
}

/**
 * 쿠키 경로 전용 CSRF 가드 (02 §A D-T3: SameSite=Lax + 커스텀 헤더 + Origin 검증).
 *
 * - **커스텀 헤더 요구**: `<form>`·`<img>` 같은 단순 요청으로는 붙일 수 없고, fetch/XHR이 붙이면
 *   비-safelisted 헤더라 **프리플라이트가 강제**된다 → CORS 화이트리스트가 2차로 막는다.
 * - **Origin(없으면 Referer) 화이트리스트**: SameSite는 *사이트* 단위라 형제 서브도메인發 요청을
 *   막지 못한다. 오리진 대조가 그 구멍을 닫는다.
 * - 두 검사 모두 통과 못 하면 403. WEB_ORIGINS 미설정이면 화이트리스트가 비어 **쿠키 경로 전체가
 *   닫힌다**(전면 차단 기본값 — CORS 실패 모드와 같은 방향).
 *
 * 기존 **바디 방식 경로에는 붙이지 않는다** — 네이티브 앱은 Origin·커스텀 헤더를 보내지 않으며
 * 애초에 쿠키를 쓰지 않아 CSRF 대상이 아니다(무회귀).
 */
@Injectable()
export class WebCsrfGuard implements CanActivate {
  /**
   * ⚠️ WEB_ORIGINS는 `config/env.schema.ts`(Env) **밖**이다 — 이 태스크의 파일 소유권상 스키마를
   * 넓히지 않았다. 비타입 ConfigService 조회는 process.env를 그대로 읽으므로 셸·컨테이너
   * environment/env_file로 주입하면 동작한다(리포 루트 `.env` 파일만 넣으면 zod가 미지의 키를
   * 벗겨내 도달하지 않는다 — env.schema에 키를 추가하는 후속 작업이 필요하다).
   */
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    if (!hasCsrfHeader(req.headers)) {
      throw new DomainException('forbidden', 'X-Requested-With 헤더가 필요합니다');
    }

    const origin = requestOrigin(req.headers);
    const raw = this.config.get<string>(WEB_ORIGINS_ENV_KEY);
    if (!isAllowedWebOrigin(origin, raw)) {
      throw new DomainException('forbidden', '허용되지 않은 오리진입니다');
    }
    return true;
  }
}

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: '이메일+비밀번호 로그인 → user + 토큰쌍' })
  login(@Body() body: LoginDto): Promise<LoginResponse> {
    return this.auth.login(body.email, body.password);
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'refresh 회전 — 1회용, 재사용 탐지 시 family 전체 폐기' })
  refresh(@Body() body: RefreshTokenDto): Promise<RefreshTokenResponse> {
    return this.auth.refresh(body.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth()
  @ApiOperation({ summary: '로그아웃 — 해당 세션(family)만 폐기 (다기기 지원)' })
  async logout(@Body() body: LogoutDto): Promise<void> {
    await this.auth.logout(body.refreshToken);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: '내 정보 (access 토큰 기준)' })
  me(@CurrentUser() user: User): User {
    return user;
  }

  /* ── 웹(브라우저) 쿠키 세션 — 위 바디 경로와 **병행**. 회전·재사용 탐지는 동일 TokenService ── */

  @Public()
  @UseGuards(WebCsrfGuard)
  @Post('web/login')
  @HttpCode(200)
  @ApiOperation({
    summary: '[웹] 로그인 — refresh는 HttpOnly 쿠키로만 내려간다(바디 미포함)',
  })
  async webLogin(
    @Body() body: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebLoginResponse> {
    const { user, tokens } = await this.auth.login(body.email, body.password);
    this.setRefreshCookie(req, res, tokens);
    return { user, ...this.toWebSession(tokens) };
  }

  @Public()
  @UseGuards(WebCsrfGuard)
  @Post('web/refresh')
  @HttpCode(200)
  @ApiOperation({
    summary: '[웹] refresh 회전 — 쿠키에서 읽어 회전하고 새 쿠키로 교체(바디 미사용)',
  })
  async webRefresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<WebSessionResponse> {
    let tokens: AuthTokens;
    try {
      // 이 경로는 **쿠키만** 본다 — 바디를 받으면 공격자가 임의 토큰을 밀어 넣을 통로가 생긴다
      const current = readWebRefreshCookie(req.headers.cookie);
      if (!current) {
        throw new DomainException('unauthorized', '세션이 없습니다. 다시 로그인해 주세요');
      }
      tokens = await this.auth.refresh(current);
    } catch (e) {
      // 죽은 쿠키(만료·재사용 탐지로 family 폐기·모호)는 즉시 제거한다.
      // 남겨두면 브라우저가 같은 토큰을 계속 재전송해 재사용 탐지를 반복 트리거한다.
      this.clearRefreshCookies(res);
      throw e;
    }
    this.setRefreshCookie(req, res, tokens);
    return this.toWebSession(tokens);
  }

  @Public()
  @UseGuards(WebCsrfGuard)
  @Post('web/logout')
  @HttpCode(204)
  @ApiOperation({ summary: '[웹] 로그아웃 — 세션(family) 폐기 + 쿠키 제거 (멱등)' })
  async webLogout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    this.clearRefreshCookies(res); // 서버 폐기 성패와 무관하게 브라우저 쪽은 항상 정리
    let current: string | null = null;
    try {
      current = readWebRefreshCookie(req.headers.cookie);
    } catch {
      return; // 모호한 쿠키 — 지운 것으로 충분(멱등)
    }
    if (!current) return;
    try {
      await this.auth.logout(current);
    } catch (e) {
      // 이미 폐기·만료된 세션의 로그아웃은 성공으로 취급한다(멱등). 원인은 로그로만.
      this.logger.warn(`웹 로그아웃 중 세션 폐기 실패(무시): ${(e as Error).message}`);
    }
  }

  /** refresh 원문 제거 — 웹 응답 바디에 남기지 않는다 */
  private toWebSession(tokens: AuthTokens): WebSessionResponse {
    return {
      accessToken: tokens.accessToken,
      accessTokenExpiresAt: tokens.accessTokenExpiresAt,
      refreshTokenExpiresAt: tokens.refreshTokenExpiresAt,
    };
  }

  private setRefreshCookie(req: Request, res: Response, tokens: AuthTokens): void {
    const secure = isSecureCookieContext(req.headers, this.config.get('NODE_ENV', { infer: true }));
    const maxAgeSec = Math.floor((Date.parse(tokens.refreshTokenExpiresAt) - Date.now()) / 1000);
    res.setHeader('Set-Cookie', serializeRefreshCookie(tokens.refreshToken, { secure, maxAgeSec }));
  }

  private clearRefreshCookies(res: Response): void {
    res.setHeader('Set-Cookie', expiredRefreshCookies());
  }
}
