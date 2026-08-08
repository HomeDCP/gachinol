import { Injectable } from '@nestjs/common';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import type { AuthTokens, LoginResponse } from '@gachinol/shared';
import * as argon2 from 'argon2';
import { DomainException } from '../common/errors/domain.exception';
import { PrismaService } from '../prisma/prisma.service';
import { toUser } from '../users/user.mapper';
import { ARGON2_OPTIONS } from './argon2.options';
import { TokenService } from './token.service';

/** 계정 열거 방지 — 이메일 부재/비번 불일치/비활성 구분 없이 동일 메시지 */
const LOGIN_FAILED = () =>
  new DomainException('unauthorized', '이메일 또는 비밀번호가 올바르지 않습니다');

/**
 * 타이밍 균일화용 더미 해시 (1회 선계산) — 계정 부재·비번 미설정 경로도 실제 계정과
 * 동일한 argon2 verify 비용을 지불해, 응답 시간 차로 계정 존재가 열거되지 않게 한다.
 */
const DUMMY_HASH: Promise<string> = argon2.hash('timing-equalizer-dummy-password', ARGON2_OPTIONS);

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  async login(email: string, password: string): Promise<LoginResponse> {
    const row = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!row?.passwordHash) {
      // 더미 해시 검증으로 시간 프로파일 균일화 — 결과는 버리고 항상 동일 401
      await argon2.verify(await DUMMY_HASH, password).catch(() => false);
      throw LOGIN_FAILED();
    }

    const ok = await argon2.verify(row.passwordHash, password).catch(() => false);
    if (!ok) throw LOGIN_FAILED();
    if (row.status !== 'active') throw LOGIN_FAILED();

    const user = toUser(row);
    const tokens = await this.tokens.issueForLogin(user);
    return { user, tokens };
  }

  refresh(refreshToken: string): Promise<AuthTokens> {
    return this.tokens.rotate(refreshToken);
  }

  logout(refreshToken: string): Promise<void> {
    return this.tokens.revokeSession(refreshToken);
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * 웹(브라우저) 세션 보안 — 쿠키 refresh · CSRF · CORS 오리진 화이트리스트
 *
 * 네이티브 앱은 refresh를 **바디**로 주고받고(secure-store 보관), 웹은 XSS로 그 값이
 * 통째로 새므로 refresh를 **HttpOnly 쿠키**로만 전달한다(02 §A D-T3). 두 경로는 병행이며
 * 회전·재사용 탐지는 TokenService 하나를 공유한다(규칙 사본 금지).
 *
 * 여기 있는 함수는 전부 순수(프레임워크 무관) — AuthController(쿠키·CSRF)와
 * main.ts(CORS)가 함께 소비한다. 컨트롤러→서비스 단방향이라 순환 없음.
 * ══════════════════════════════════════════════════════════════════════════ */

/** 웹 오리진 화이트리스트 env 키 — 값은 쉼표(또는 공백) 구분 오리진 목록 */
export const WEB_ORIGINS_ENV_KEY = 'WEB_ORIGINS';

/**
 * refresh 쿠키 이름 2종.
 * 보안 컨텍스트(HTTPS)에서는 `__Host-` 접두를 쓴다 — 브라우저가 **Domain 금지·Path=/·Secure**를
 * 강제하므로 형제 서브도메인(`watch.`·`go.` 등)이 상위 도메인 쿠키를 밀어 넣는 쿠키 토싱
 * (= 세션 고정)이 원천 차단된다. `__Host-`는 Secure 없이는 브라우저가 아예 저장하지 않으므로
 * 평문 http인 개발 환경에서는 접두 없는 이름으로 저하 운용한다.
 */
export const WEB_REFRESH_COOKIE_SECURE = '__Host-gachinol_rt';
export const WEB_REFRESH_COOKIE = 'gachinol_rt';

/**
 * 쿠키 Path는 항상 `/` — `__Host-` 접두의 요건이다.
 * 좁은 Path(`/v1/auth`)로 노출을 줄이는 대안도 있으나, ① 접두를 포기해야 하고
 * ② 다른 엔드포인트는 애초에 쿠키를 읽지 않는다(Bearer 전용)라 CSRF 표면이 늘지 않는다.
 * 토싱 방어(①)가 더 크다고 보고 Path=/를 택한다.
 */
const WEB_COOKIE_PATH = '/';

/** CSRF 커스텀 헤더 — 단순 요청(form·img)으로는 붙일 수 없고, 붙이면 프리플라이트가 강제된다 */
export const CSRF_HEADER = 'x-requested-with';

type HeaderBag = Record<string, string | string[] | undefined>;

const firstHeader = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/** WEB_ORIGINS 파싱 결과 — invalid는 조용히 버리지 않고 부팅 로그로 드러낸다(오설정 가시화) */
export interface WebOriginList {
  readonly allowed: string[];
  readonly invalid: string[];
}

/**
 * 오리진 정규화 — `scheme://host[:port]`만 인정한다.
 * `*`(전면 허용)·자격증명 포함·경로/쿼리 포함은 전부 invalid로 떨어뜨린다.
 * credentials 허용 CORS에서 `*`는 스펙상으로도 금지이며, 여기서 막지 않으면
 * 오타 하나가 전 오리진 허용으로 번역될 수 있다.
 */
function normalizeOrigin(entry: string): string | null {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username || url.password) return null;
  if (url.pathname !== '/' && url.pathname !== '') return null; // trailing slash까지만 허용
  if (url.search || url.hash) return null;
  return url.origin; // 호스트 소문자·기본 포트 제거까지 정규화
}

export function parseWebOrigins(raw?: string | null): WebOriginList {
  const allowed: string[] = [];
  const invalid: string[] = [];
  for (const piece of (raw ?? '').split(/[,\s]+/)) {
    const entry = piece.trim();
    if (!entry) continue;
    const normalized = normalizeOrigin(entry);
    if (!normalized) {
      invalid.push(entry);
      continue;
    }
    if (!allowed.includes(normalized)) allowed.push(normalized);
  }
  return { allowed, invalid };
}

export function isAllowedWebOrigin(
  origin: string | null | undefined,
  raw?: string | null,
): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return parseWebOrigins(raw).allowed.includes(normalized);
}

/**
 * CORS 옵션 — 화이트리스트 오리진에만 credentials를 허용한다.
 *
 * **실패 모드 = 전면 차단**: WEB_ORIGINS 미설정·전건 무효면 null을 돌려주고 호출부는
 * enableCors 자체를 호출하지 않는다(현행 동작과 동일 = 무회귀). 미설정을 "전면 허용"으로
 * 읽는 반대 기본값은 쿠키 세션과 결합하는 순간 그대로 CSRF 통로가 된다.
 */
export function buildWebCorsOptions(raw?: string | null): CorsOptions | null {
  const { allowed } = parseWebOrigins(raw);
  if (allowed.length === 0) return null;
  const allowSet = new Set(allowed);
  return {
    origin: (candidate, callback) => {
      // 정확 일치만 — 접두/부분 일치는 `watch.gachinol.kr.evil.kr` 류를 통과시킨다
      callback(null, !!candidate && allowSet.has(candidate));
    },
    credentials: true, // 쿠키 refresh 경로의 전제. 화이트리스트 오리진에만 반사된다
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    maxAge: 600,
  };
}

/**
 * 요청 오리진 — Origin 우선, 없으면 Referer에서 파생.
 * 불투명 오리진(`null` 문자열: 샌드박스 iframe·일부 리다이렉트)은 허용 대상이 될 수 없다.
 */
export function requestOrigin(headers: HeaderBag): string | null {
  const origin = firstHeader(headers['origin']);
  if (origin && origin !== 'null') return normalizeOrigin(origin);
  const referer = firstHeader(headers['referer']);
  if (!referer) return null;
  try {
    return normalizeOrigin(new URL(referer).origin);
  } catch {
    return null;
  }
}

/** CSRF 커스텀 헤더 존재 여부(값은 관용) — 존재 자체가 프리플라이트를 강제하는 것이 방어의 실체 */
export function hasCsrfHeader(headers: HeaderBag): boolean {
  return (firstHeader(headers[CSRF_HEADER]) ?? '').trim().length > 0;
}

/** Cookie 헤더 파싱 — 동명 쿠키가 여러 번 올 수 있으므로(토싱) 값 배열로 보존한다 */
export function parseCookieHeader(raw?: string | null): Map<string, string[]> {
  const jar = new Map<string, string[]>();
  for (const piece of (raw ?? '').split(';')) {
    const eq = piece.indexOf('=');
    if (eq <= 0) continue;
    const name = piece.slice(0, eq).trim();
    if (!name) continue;
    const value = piece.slice(eq + 1).trim();
    const bucket = jar.get(name);
    if (bucket) bucket.push(value);
    else jar.set(name, [value]);
  }
  return jar;
}

/**
 * refresh 쿠키 읽기 — `__Host-` 이름과 평문 이름 양쪽을 본다(HTTPS 승격 전후 호환).
 * **동명·이명 중복은 401로 거부**한다: 브라우저는 어느 쪽을 먼저 보낼지 보장하지 않으므로
 * 중복 자체가 쿠키 토싱(세션 고정) 신호다. 호출부는 이 예외에서 쿠키를 지워 복구시킨다.
 */
export function readWebRefreshCookie(cookieHeader?: string | null): string | null {
  const jar = parseCookieHeader(cookieHeader);
  const values = [
    ...(jar.get(WEB_REFRESH_COOKIE_SECURE) ?? []),
    ...(jar.get(WEB_REFRESH_COOKIE) ?? []),
  ].filter((v) => v.length > 0);
  if (values.length === 0) return null;
  if (values.length > 1) {
    throw new DomainException('unauthorized', '세션 쿠키가 모호합니다. 다시 로그인해 주세요');
  }
  try {
    return decodeURIComponent(values[0] as string);
  } catch {
    // 깨진 퍼센트 인코딩 — 우리가 쓴 쿠키가 아니다(500이 아니라 401로 수렴시킨다)
    throw new DomainException('unauthorized', '세션 쿠키를 읽을 수 없습니다');
  }
}

/**
 * Secure 판정 — 프로덕션은 항상(Cloudflare TLS 종단 전제), 그 외에는 요청이 https일 때만.
 * `x-forwarded-proto`는 위조돼도 쿠키를 **더 엄격하게** 만들 뿐이라 안전한 방향이다.
 */
export function isSecureCookieContext(headers: HeaderBag, nodeEnv: string): boolean {
  if (nodeEnv === 'production') return true;
  const proto = firstHeader(headers['x-forwarded-proto'])?.split(',')[0]?.trim().toLowerCase();
  return proto === 'https';
}

export function refreshCookieName(secure: boolean): string {
  return secure ? WEB_REFRESH_COOKIE_SECURE : WEB_REFRESH_COOKIE;
}

/**
 * Set-Cookie 직렬화.
 * `SameSite=Lax`: 웹 3종(`watch.`·`reporter.`·`center.`)과 api(`api.`)는 **같은 site**(eTLD+1 동일)라
 * 서브도메인 간 XHR에도 쿠키가 붙는다 — Lax가 성립한다. `None`은 크로스사이트 배치에서만
 * 필요하고 그 즉시 CSRF 방어를 헤더/오리진 검증에만 의존하게 만들어 채택하지 않는다.
 * `Domain` 미지정 = host-only — 쿠키가 api 호스트 밖으로 나가지 않는다.
 */
export function serializeRefreshCookie(
  token: string,
  opts: { secure: boolean; maxAgeSec: number },
): string {
  const attrs = [
    `${refreshCookieName(opts.secure)}=${encodeURIComponent(token)}`,
    `Path=${WEB_COOKIE_PATH}`,
    'HttpOnly',
    'SameSite=Lax',
  ];
  // Max-Age가 계산 불가(만료 시각 파싱 실패)면 속성 자체를 생략해 세션 쿠키로 저하시킨다 —
  // `Max-Age=NaN`은 잘못된 속성이고, 0으로 대체하면 방금 발급한 세션이 즉시 삭제된다
  if (Number.isFinite(opts.maxAgeSec)) {
    attrs.push(`Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`);
  }
  if (opts.secure) attrs.push('Secure');
  return attrs.join('; ');
}

/** 두 이름을 모두 만료시킨다 — 환경 전환(http↔https)으로 남은 반대쪽 쿠키가 401을 고착시키지 않도록 */
export function expiredRefreshCookies(): string[] {
  return [WEB_REFRESH_COOKIE_SECURE, WEB_REFRESH_COOKIE].map((name) => {
    const attrs = [`${name}=`, `Path=${WEB_COOKIE_PATH}`, 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (name === WEB_REFRESH_COOKIE_SECURE) attrs.push('Secure'); // __Host- 요건
    return attrs.join('; ');
  });
}
