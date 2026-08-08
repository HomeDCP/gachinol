import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ContentId, TextAnalysis } from '@gachinol/shared';
import { zId } from '../common/zod';
import { S3Service } from '../media/s3.service';
import { PrismaService } from '../prisma/prisma.service';

/* ══════════════════════════════════════════════════════════════════════════
 * `go.<도메인>` 단축링크 OG SSR (02 §D-T6 기본안 · §E 5번)
 *
 * 콘텐츠는 **빌드 이후에 생성**되므로 expo-router 정적 렌더링은 신규 콘텐츠 라우트의 OG 메타를
 * 애초에 만들 수 없다(02 §D-T6 사실 정정 — 상시 참). 그래서 카톡 채널에 붙는 모든 콘텐츠 링크는
 * 이 api 경량 라우트를 경유해 **OG 태그만 SSR**한 뒤 구독자 웹(`watch.`)으로 보낸다.
 *
 * ── 도메인 하드코딩 0 (G9 ①: 실 도메인 미확정) ─────────────────────────────
 * 공개 베이스(`go.`)·목적지 베이스(`watch.`)는 전부 env로 주입한다. 이 파일에는 어떤 호스트도
 * 리터럴로 존재하지 않으며, `GO_LINK_BASE_URL` 미설정 시에는 **요청 자신의 절대 URL**로 저하
 * 운용한다(자기참조라 도메인 지식이 필요 없다). 목적지(`WEB_WATCH_BASE_URL`)는 자기참조가
 * 불가능하므로 **추측하지 않고**(예: `go.`→`watch.` 치환) 미설정을 미설정으로 드러낸다.
 *
 * ── 왜 302가 아니라 200 HTML인가 (계획 문언과의 의식적 차이) ────────────────
 * 02 §D-T6 가용성 조치 1·§D-T5 3항은 "`go.`의 **302** 응답을 Cloudflare Cache Everything +
 * stale 서빙으로 캐시"라고 적는다. 그런데 302에는 본문이 없어 OG 태그를 실을 수 없으므로,
 * 302를 쓰려면 크롤러 UA에만 200 HTML을 주는 **UA 분기(2개 변형)**가 강제된다. Cloudflare는
 * `Vary: Accept-Encoding` 외의 Vary를 캐시 키에 반영하지 않으므로(Free/Pro), Cache Everything이
 * 켜지는 순간 두 변형 중 하나가 모두에게 서빙된다 —
 *   · 302가 캐시돼 카카오 스크레이퍼에 서빙되면 **미리보기(=이 태스크의 DoD)가 깨지고**,
 *   · 200 HTML이 캐시돼 사람에게 서빙되면 아래의 즉시 클라이언트 리다이렉트로 **정상 도달**한다.
 * 즉 단일 변형으로 두 소비자 모두에게 옳은 응답은 "OG 200 HTML + 즉시 리다이렉트"뿐이다.
 * 덤으로 캐시된 HTML 자체가 `watch.` 직접 링크를 본문에 담으므로, api 다운 중 stale 서빙만으로
 * **미리보기와 이동이 동시에 생존**한다(조치 1의 목표가 302보다 더 온전히 성립한다).
 * ※ 계획 문언의 "302" 표기 정정은 조율자 위임 사항으로 완료 보고에 등재한다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** `go.` 단축링크 공개 베이스 URL(예: `https://go.<도메인>`). 미설정 시 요청 자기 URL로 저하 */
export const GO_LINK_BASE_URL_ENV_KEY = 'GO_LINK_BASE_URL';
/** 구독자 웹(`watch.`) 베이스 URL — 리다이렉트 목적지이자 직접 링크 병행 발급(조치 2)의 원천 */
export const WEB_WATCH_BASE_URL_ENV_KEY = 'WEB_WATCH_BASE_URL';
/** OG 페이지 엣지/브라우저 캐시 TTL(초) — §D-T6 "짧은 TTL" */
export const GO_LINK_CACHE_TTL_ENV_KEY = 'GO_LINK_CACHE_TTL_SEC';
/** api 다운 시 stale 서빙 허용 창(초) — `stale-if-error` */
export const GO_LINK_STALE_TTL_ENV_KEY = 'GO_LINK_STALE_TTL_SEC';

/** `go.` 호스트에서의 공개 경로 접두 — 공개 URL은 `<GO_LINK_BASE_URL>/c/<id>` */
export const GO_LINK_PUBLIC_PATH = '/c';
/** 구독자 웹의 콘텐츠 상세 경로(apps/subscriber `app/watch/[id].tsx`) */
export const WATCH_PATH = '/watch';

const DEFAULT_CACHE_TTL_SEC = 300;
const DEFAULT_STALE_TTL_SEC = 604800; // 7일 — 제온 다운이 길어져도 캐시된 링크는 생존
const STALE_WHILE_REVALIDATE_SEC = 60;
/** 없는 링크의 음성 캐시 — 오리진 보호용으로 짧게만(발행 직후 링크가 오래 죽어 있으면 안 된다) */
const NOT_FOUND_CACHE_SEC = 60;
const OG_DESCRIPTION_MAX = 200;
const OG_TITLE_MAX = 120;
const SITE_NAME = '가치놀 마을방송국';

/* ────────────────────────── 순수 헬퍼(프레임워크 무관) ────────────────────────── */

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * HTML 이스케이프 — 제목·요약은 **DB에서 온 사용자 입력**이라 그대로 넣으면 OG 페이지가 그대로
 * XSS 표면이 된다. 텍스트/속성 문맥 모두에 안전하도록 5문자를 전부 치환하고, 제어문자는
 * 공백으로 접는다(속성값 줄바꿈으로 태그가 깨지는 것 방지).
 */
export const escapeHtml = (value: string): string => {
  let out = '';
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    out += code < 0x20 || code === 0x7f ? ' ' : (HTML_ESCAPES[ch] ?? ch);
  }
  return out;
};

/** `<script>` 안에 URL을 안전하게 심는다 — JSON 리터럴 + `<` 이스케이프로 조기 종료 차단 */
export const toJsStringLiteral = (value: string): string =>
  JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * 베이스 URL 정규화 — http/https 절대 URL만 인정하고 끝의 `/`를 제거한다.
 * 오타·상대경로·자격증명/쿼리 포함 값은 null로 떨어뜨려 "설정 안 됨"과 동일하게 취급한다
 * (조용히 잘못된 링크를 발급하는 것보다 미설정으로 드러나는 편이 낫다).
 */
export const normalizeBaseUrl = (raw: unknown): string | null => {
  if (typeof raw !== 'string' || raw.trim().length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
};

/** 서로게이트 안전 절삭 + 말줄임(연속 공백은 한 칸으로 접는다) */
export const truncateText = (value: string, max: number): string => {
  const chars = [...value.trim().replace(/\s+/g, ' ')];
  return chars.length <= max ? chars.join('') : `${chars.slice(0, max - 1).join('')}…`;
};

type HeaderBag = Record<string, string | string[] | undefined>;

const firstHeader = (v: string | string[] | undefined): string | undefined => {
  const raw = Array.isArray(v) ? v[0] : v;
  return raw?.split(',')[0]?.trim() || undefined;
};

/** 호스트 헤더 주입으로 og:url이 오염되지 않도록 문자셋을 좁게 검증한다 */
const SAFE_HOST = /^[A-Za-z0-9.\-[\]]+(:\d{1,5})?$/;

/**
 * 요청 자신의 절대 URL — `GO_LINK_BASE_URL` 미설정 시의 저하 경로.
 * 프록시(Cloudflare·nginx) 뒤라 `X-Forwarded-*`를 우선 보되, 형식이 어긋나면 폴백으로 되돌린다.
 * 경로를 요청에서 그대로 받으므로 **전역 프리픽스(`v1`) 지식이 이 모듈에 새지 않는다**.
 */
export const deriveSelfUrl = (
  headers: HeaderBag,
  fallback: { protocol: string; host?: string; path: string },
): string => {
  const proto = firstHeader(headers['x-forwarded-proto']) ?? fallback.protocol;
  const safeProto = proto === 'https' || proto === 'http' ? proto : 'https';
  const candidate = firstHeader(headers['x-forwarded-host']) ?? fallback.host;
  const fallbackHost = fallback.host && SAFE_HOST.test(fallback.host) ? fallback.host : 'localhost';
  const host = candidate && SAFE_HOST.test(candidate) ? candidate : fallbackHost;
  return `${safeProto}://${host}${fallback.path}`;
};

/** 공유 링크 2종 — 조치 2(직접 링크 병행 발급)의 단일 발급 지점 */
export interface ShareLinks {
  /** 카톡 채널에 붙는 단축 링크(`go.<도메인>/c/<id>`) */
  readonly shortUrl: string;
  /** `go.` 의존을 줄이기 위한 직접 링크(`watch.<도메인>/watch/<id>`). 미설정 시 null */
  readonly directUrl: string | null;
}

export interface SharePageView {
  readonly title: string;
  readonly description: string;
  readonly siteName: string;
  readonly shortUrl: string;
  /** null이면 목적지 미설정 — 리다이렉트 없이 안내만 렌더한다 */
  readonly directUrl: string | null;
  readonly imageUrl: string | null;
  readonly publishedAt: string | null;
}

/** 고령층 가독성 기준(03 §A-1 본문 18px+·터치 44px+)을 이 폴백 화면에도 적용한다 */
const PAGE_STYLE =
  'body{margin:0;padding:24px;font-family:system-ui,-apple-system,"Apple SD Gothic Neo",sans-serif;' +
  'font-size:18px;line-height:1.6;color:#1a1a1a;background:#fff}' +
  'main{max-width:640px;margin:0 auto}h1{font-size:22px;margin:0 0 12px}' +
  'a.go{display:inline-block;min-height:44px;line-height:44px;padding:0 20px;margin-top:16px;' +
  'border-radius:8px;background:#1f6feb;color:#fff;text-decoration:none;font-weight:700}';

/**
 * OG SSR 본문 — 크롤러가 문서 앞부분만 읽는 경우가 있어 **OG 메타를 head 최상단**에 둔다.
 * 사람에게는 `<script>`(즉시)·`<meta refresh>`(JS off) 두 경로로 리다이렉트하고, 둘 다 막힌
 * 환경을 위해 본문에 직접 링크 앵커를 남긴다 — 이 앵커가 stale 서빙 시의 최종 생존 경로다.
 */
export const renderSharePage = (v: SharePageView): string => {
  const title = escapeHtml(v.title);
  const description = escapeHtml(v.description);
  const head: string[] = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta property="og:type" content="article">',
    `<meta property="og:site_name" content="${escapeHtml(v.siteName)}">`,
    '<meta property="og:locale" content="ko_KR">',
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${escapeHtml(v.shortUrl)}">`,
  ];
  if (v.imageUrl) head.push(`<meta property="og:image" content="${escapeHtml(v.imageUrl)}">`);
  if (v.publishedAt) {
    head.push(`<meta property="article:published_time" content="${escapeHtml(v.publishedAt)}">`);
  }
  head.push(
    `<meta name="twitter:card" content="${v.imageUrl ? 'summary_large_image' : 'summary'}">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
  );
  if (v.directUrl) {
    // canonical은 실제 콘텐츠 페이지(`watch.`)를 가리킨다 — `go.`는 공유용 진입구일 뿐이다
    head.push(
      `<link rel="canonical" href="${escapeHtml(v.directUrl)}">`,
      `<meta http-equiv="refresh" content="0;url=${escapeHtml(v.directUrl)}">`,
    );
  }
  head.push(`<title>${title}</title>`, `<style>${PAGE_STYLE}</style>`);

  const body = v.directUrl
    ? '<p>동영상 화면으로 이동하고 있습니다.</p>' +
      `<p><a class="go" href="${escapeHtml(v.directUrl)}">바로 보기</a></p>` +
      `<script>location.replace(${toJsStringLiteral(v.directUrl)})</script>`
    : '<p>재생 화면 주소가 아직 설정되지 않았습니다. 잠시 후 다시 시도해 주세요.</p>';

  return (
    '<!doctype html><html lang="ko"><head>' +
    head.join('') +
    `</head><body><main><h1>${title}</h1><p>${description}</p>${body}</main></body></html>`
  );
};

/** 없는·만료된 링크 — OG 메타를 **일부러 넣지 않는다**(죽은 링크에 미리보기가 뜨면 안 된다) */
export const renderNotFoundPage = (homeUrl: string | null): string => {
  const home = homeUrl
    ? `<p><a class="go" href="${escapeHtml(homeUrl)}">방송 홈으로</a></p>`
    : '<p>주소를 다시 확인해 주세요.</p>';
  return (
    '<!doctype html><html lang="ko"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    `<title>콘텐츠를 찾을 수 없습니다</title><style>${PAGE_STYLE}</style></head>` +
    '<body><main><h1>콘텐츠를 찾을 수 없습니다</h1>' +
    '<p>삭제되었거나 아직 공개되지 않은 영상입니다.</p>' +
    `${home}</main></body></html>`
  );
};

/** 컨트롤러가 그대로 기록하는 HTTP 응답 서술 — 서비스는 express에 의존하지 않는다 */
export interface GoLinkHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}

const HTML_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
} as const;

const TEXT_HEADERS = {
  'Content-Type': 'text/plain; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
} as const;

/* ─────────────────────────────── 서비스 ─────────────────────────────── */

@Injectable()
export class GoLinkService {
  private readonly logger = new Logger(GoLinkService.name);
  private warnedMissingWatchBase = false;

  /**
   * ⚠️ `GO_LINK_*`·`WEB_WATCH_BASE_URL`은 `config/env.schema.ts`(Env) **밖**이다 — 이 태스크의
   * 파일 소유권상 스키마를 넓히지 않았다(WEB_ORIGINS/T-W0-01 선례와 동일). 비타입 ConfigService
   * 조회는 process.env를 그대로 읽으므로 셸·컨테이너 environment/env_file로 주입하면 동작한다
   * (리포 루트 `.env` 파일만 넣으면 zod가 미지의 키를 벗겨내 도달하지 않는다 — env.schema 등재는
   * 후속 조율자 작업).
   */
  constructor(
    private readonly prisma: PrismaService,
    private readonly s3: S3Service,
    private readonly config: ConfigService,
  ) {}

  /**
   * 조치 2 — **단축 링크와 직접 링크의 단일 발급 지점**.
   * 반자동 게시 담당자용 게시자산(캡션·딥링크) 준비 경로도 이 함수를 소비해야 두 링크가
   * 어긋나지 않는다(카카오 어댑터 배선은 이 태스크의 파일 소유권 밖 — 후속 위임).
   */
  buildShareLinks(contentId: string, selfUrl?: string): ShareLinks {
    const base = normalizeBaseUrl(this.config.get(GO_LINK_BASE_URL_ENV_KEY));
    const shortUrl = base
      ? `${base}${GO_LINK_PUBLIC_PATH}/${encodeURIComponent(contentId)}`
      : (selfUrl ?? `${GO_LINK_PUBLIC_PATH}/${encodeURIComponent(contentId)}`);
    return { shortUrl, directUrl: this.watchUrl(contentId) };
  }

  /** `watch.<도메인>/watch/:id` — 미설정이면 추측하지 않고 null */
  private watchUrl(contentId: string): string | null {
    const base = normalizeBaseUrl(this.config.get(WEB_WATCH_BASE_URL_ENV_KEY));
    if (!base) {
      if (!this.warnedMissingWatchBase) {
        this.warnedMissingWatchBase = true;
        this.logger.warn(
          `${WEB_WATCH_BASE_URL_ENV_KEY} 미설정 — go. 링크가 리다이렉트 없이 안내만 렌더합니다(응답은 캐시 금지)`,
        );
      }
      return null;
    }
    return `${base}${WATCH_PATH}/${encodeURIComponent(contentId)}`;
  }

  private readInt(key: string, fallback: number, min: number): number {
    const n = Number(this.config.get(key));
    return Number.isFinite(n) && n >= min ? Math.floor(n) : fallback;
  }

  private get cacheTtlSec(): number {
    return this.readInt(GO_LINK_CACHE_TTL_ENV_KEY, DEFAULT_CACHE_TTL_SEC, 1);
  }

  /**
   * OG 페이지 캐시 지시자.
   * `stale-if-error`가 D-T6 조치 1(api 다운 시 stale 서빙)에 대해 **코드가 낼 수 있는 신호의
   * 전부**다 — 실제 Cache Everything 규칙·엣지 stale 정책은 Cloudflare 존 설정 몫이며
   * 이 리포에서는 검증되지 않는다(EXEC-DECISIONS #12: CF 계정·존 부재).
   * `Vary: User-Agent`는 **의도적으로 넣지 않는다** — 단일 변형 설계라 캐시를 쪼갤 이유가 없다.
   */
  private cacheableHeaders(): Record<string, string> {
    const ttl = this.cacheTtlSec;
    const stale = this.readInt(GO_LINK_STALE_TTL_ENV_KEY, DEFAULT_STALE_TTL_SEC, 0);
    return {
      ...HTML_HEADERS,
      'Cache-Control':
        `public, max-age=${ttl}, s-maxage=${ttl}, ` +
        `stale-while-revalidate=${STALE_WHILE_REVALIDATE_SEC}, stale-if-error=${stale}`,
      // CF는 CDN-Cache-Control을 Cache-Control보다 우선한다 — 엣지 TTL을 따로 조율할 여지
      'CDN-Cache-Control': `public, max-age=${ttl}, stale-if-error=${stale}`,
    };
  }

  private notFound(): GoLinkHttpResponse {
    const base = normalizeBaseUrl(this.config.get(WEB_WATCH_BASE_URL_ENV_KEY));
    return {
      status: 404,
      headers: {
        ...HTML_HEADERS,
        'Cache-Control': `public, max-age=${NOT_FOUND_CACHE_SEC}`,
        'CDN-Cache-Control': `public, max-age=${NOT_FOUND_CACHE_SEC}`,
      },
      body: renderNotFoundPage(base ? `${base}/` : null),
    };
  }

  /**
   * `GET /c/:id` — published 콘텐츠의 OG SSR 페이지.
   * 비published·부재·형식 오류는 전부 404 HTML로 수렴한다(도메인 예외를 던지면 전역 필터가 JSON
   * ApiError를 내보내는데, 이 라우트의 소비자는 브라우저·크롤러라 JSON이 아무 의미가 없다).
   */
  async renderContentShare(rawId: string, ctx: { selfUrl: string }): Promise<GoLinkHttpResponse> {
    if (!zId<ContentId>().safeParse(rawId).success) return this.notFound();

    const row = await this.prisma.content.findUnique({
      where: { id: rawId },
      include: { station: { select: { name: true } } },
    });
    if (!row || row.status !== 'published') return this.notFound();

    const { shortUrl, directUrl } = this.buildShareLinks(rawId, ctx.selfUrl);

    // 썸네일은 **존재 여부만** 확인한다 — HTML 조립 경로에서 S3 서명을 하지 않으므로
    // 자격 미설정·S3 장애가 OG 페이지를 무너뜨리지 못하고, og:image는 만료되지 않는
    // 안정 URL(`<short>/thumb`)이 되어 스크레이퍼 재수집·stale 서빙에도 살아남는다.
    const thumb = await this.prisma.mediaAsset.findFirst({
      where: { contentId: rawId, kind: 'thumbnail', generation: row.generation, status: 'ready' },
      select: { id: true },
    });

    const html = renderSharePage({
      title: truncateText(row.title, OG_TITLE_MAX),
      description: await this.resolveDescription(row.id, row.generation, {
        description: row.description,
        stationName: row.station.name,
      }),
      siteName: SITE_NAME,
      shortUrl,
      directUrl,
      imageUrl: thumb ? `${shortUrl}/thumb` : null,
      publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
    });

    // 목적지 미설정 = 오설정 상태. 이 응답이 엣지에 캐시되면 설정을 고친 뒤에도 TTL 동안
    // 고장난 페이지가 서빙된다 → no-store로 자가 치유 가능하게 둔다.
    if (!directUrl) {
      return { status: 200, headers: { ...HTML_HEADERS, 'Cache-Control': 'no-store' }, body: html };
    }
    return { status: 200, headers: this.cacheableHeaders(), body: html };
  }

  /** 설명 우선순위: 기자 기입 → AI 요약(현 세대) → 지사 기반 기본 문구 */
  private async resolveDescription(
    contentId: string,
    generation: number,
    row: { description: string | null; stationName: string },
  ): Promise<string> {
    const written = row.description?.trim();
    if (written) return truncateText(written, OG_DESCRIPTION_MAX);

    const analysis = await this.prisma.aiAnalysis.findFirst({
      where: { contentId, generation },
      select: { text: true },
    });
    const summary = (analysis?.text as TextAnalysis | null)?.summary?.trim();
    if (summary) return truncateText(summary, OG_DESCRIPTION_MAX);

    return `${row.stationName}에서 전하는 소식입니다.`;
  }

  /**
   * `GET /c/:id/thumb` — og:image의 안정 URL. 서명 URL로 302한다.
   *
   * 캐시 TTL은 **서명 만료의 절반 이하**로 묶는다 — 그러지 않으면 엣지가 캐시한 302가 이미 만료된
   * 서명 URL을 가리켜 썸네일이 깨진다. 같은 이유로 이 응답에는 `stale-if-error`를 걸지 않는다
   * (만료된 목적지를 오래 서빙하는 것은 생존이 아니다). 영구 공개 URL로의 전환은 D-T8(W2) 몫.
   */
  async resolveThumbnail(rawId: string): Promise<GoLinkHttpResponse> {
    if (!zId<ContentId>().safeParse(rawId).success) return this.thumbnailMiss();

    const row = await this.prisma.content.findUnique({
      where: { id: rawId },
      select: { status: true, generation: true },
    });
    // 비published 콘텐츠의 썸네일을 익명에게 흘리지 않는다(피드 published-only 원칙과 동일)
    if (!row || row.status !== 'published') return this.thumbnailMiss();

    const thumb = await this.prisma.mediaAsset.findFirst({
      where: { contentId: rawId, kind: 'thumbnail', generation: row.generation, status: 'ready' },
      orderBy: { createdAt: 'desc' },
      select: { storageKey: true },
    });
    if (!thumb) return this.thumbnailMiss();

    let url: string;
    try {
      url = (await this.s3.presignGet(thumb.storageKey)).url;
    } catch (e) {
      // S3 자격 미설정·장애 — 미리보기 이미지 하나 때문에 500을 내보내지 않는다
      this.logger.warn(`썸네일 서명 실패(content=${rawId}): ${e instanceof Error ? e.message : e}`);
      return this.thumbnailMiss();
    }

    const presignTtl = this.readInt('DOWNLOAD_URL_TTL_SEC', 900, 1);
    const ttl = Math.max(30, Math.min(this.cacheTtlSec, Math.floor(presignTtl / 2)));
    return {
      status: 302,
      headers: {
        ...TEXT_HEADERS,
        Location: url,
        'Cache-Control': `public, max-age=${ttl}, s-maxage=${ttl}`,
        'CDN-Cache-Control': `public, max-age=${ttl}`,
      },
      body: '',
    };
  }

  private thumbnailMiss(): GoLinkHttpResponse {
    return {
      status: 404,
      headers: { ...TEXT_HEADERS, 'Cache-Control': `public, max-age=${NOT_FOUND_CACHE_SEC}` },
      body: '썸네일을 찾을 수 없습니다',
    };
  }
}
