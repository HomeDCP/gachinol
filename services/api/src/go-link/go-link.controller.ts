import { Controller, Get, Param, Req, Res } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { Public } from '../common/decorators/public.decorator';
import { deriveSelfUrl, GoLinkService, type GoLinkHttpResponse } from './go-link.service';

/**
 * `go.<도메인>` 단축링크 — 카톡 채널에 붙는 콘텐츠 링크의 진입구(02 §D-T6 · §E 5번).
 *
 * ── 경로 계약 ──────────────────────────────────────────────────────────────
 * 공개 URL은 `go.<도메인>/c/:id`이고, api 내부 경로는 전역 프리픽스(`v1`)가 붙어
 * `/v1/go/c/:id`가 된다. 전역 프리픽스 exclude 목록(`setup-app.ts`)은 이 태스크의 파일
 * 소유권 밖이므로 **엣지(Cloudflare/nginx)가 `go.` 호스트의 `/c/*`를 오리진 `/v1/go/c/*`로
 * 매핑**한다 — `go.`는 "어디로 보낼지"만 담당한다는 02 §D-T5 3항의 계층 분리와 정합한다.
 * 발급되는 링크 문자열 자체는 `GO_LINK_BASE_URL`(env)에서 나오므로 이 파일에 호스트 지식은 없다.
 *
 * ── 응답 형태 ──────────────────────────────────────────────────────────────
 * 소비자가 브라우저·SNS 크롤러라 응답이 HTML/리다이렉트다(JSON ApiError 계약 밖). 그래서
 * `@Res()`로 직접 기록하며, 상태·헤더·본문 결정은 전부 서비스(순수 로직)가 한다.
 * 전부 `@Public` — 카톡 대화방의 익명 사용자와 스크레이퍼가 최초 소비자다.
 */
@ApiTags('go')
@Controller('go')
export class GoLinkController {
  constructor(private readonly goLink: GoLinkService) {}

  @Public()
  @Get('c/:id')
  @ApiOperation({
    summary: '단축링크 OG SSR — 미리보기 메타 + 구독자 웹 리다이렉트 (HTML, 익명)',
    description:
      'published 콘텐츠만 200. 없는/비공개/형식 오류 id는 404 HTML(OG 없음). ' +
      '공개 경로는 `go.<도메인>/c/:id`(엣지가 이 라우트로 매핑).',
  })
  async share(@Param('id') id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    const selfUrl = deriveSelfUrl(req.headers, {
      protocol: req.protocol,
      host: req.get('host'),
      path: req.path,
    });
    send(res, await this.goLink.renderContentShare(id, { selfUrl }));
  }

  /**
   * og:image 전용 안정 URL — 서명 URL로 302.
   * Swagger 문서에서는 감춘다(사람이 호출할 표면이 아니라 크롤러가 따라가는 내부 홉).
   */
  @Public()
  @Get('c/:id/thumb')
  @ApiExcludeEndpoint()
  async thumbnail(@Param('id') id: string, @Res() res: Response): Promise<void> {
    send(res, await this.goLink.resolveThumbnail(id));
  }
}

/** 서비스가 서술한 응답을 그대로 기록 — 컨트롤러는 전송만 한다 */
function send(res: Response, out: GoLinkHttpResponse): void {
  for (const [key, value] of Object.entries(out.headers)) res.setHeader(key, value);
  res.status(out.status).send(out.body);
}
