import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { LoginResponse, RefreshTokenResponse, User } from '@gachinol/shared';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto, LogoutDto, RefreshTokenDto } from './schemas/auth.schemas';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

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
}
