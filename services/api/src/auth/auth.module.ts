import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController, WebCsrfGuard } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

/**
 * passport 미도입 — @nestjs/jwt + 자체 가드로 충분(의존 축소). 시크릿은 호출 시점마다 명시 전달.
 *
 * WebCsrfGuard는 @UseGuards로만 쓰이지만(전역 아님 — 쿠키 경로 한정) ConfigService 주입을 받으므로
 * providers에 명시 등록해 DI 해석을 결정적으로 만든다.
 */
@Module({
  imports: [JwtModule.register({ global: true })],
  controllers: [AuthController],
  providers: [AuthService, TokenService, WebCsrfGuard],
  exports: [TokenService],
})
export class AuthModule {}
