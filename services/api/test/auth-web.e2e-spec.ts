/**
 * 웹 쿠키 세션 E2E — 대장 §6-11 #61 이행(배치 판정: EXEC-DECISIONS #19).
 *
 * T-W0-01 게이트②가 실기동 HTTP 왕복으로 "동등 범위"를 외부 관측했으나(9스위트/52건 + 블랙박스
 * 14종) 그 실측이 회귀 스위트로 고정되지 않았다는 점이 이 파일의 존치 사유다. 여기서 고정하는
 * 계약은 4가지 — ① Set-Cookie 왕복 + 쿠키 속성(HttpOnly·SameSite·Secure·Path·__Host- 접두)
 * ② CSRF 가드 403(가드 부착 라우트에만, 바디 방식 기존 라우트는 무영향) ③ 회전 후 쿠키 교체 +
 * 구 토큰 무효화 + 재사용 탐지(family 전체 폐기). 신규 기능 검증이 아니라 **기존 검증의
 * 영속화**이므로 구현(services/api/src/auth/**)은 이 작업이 건드리지 않는다.
 *
 * 쿠키 "이름" 상수만 auth.service.ts에서 그대로 가져온다(마법 문자열 회피). 그러나 각 단언은
 * **실제 HTTP 응답 헤더를 이 파일이 직접 파싱**해서 확인한다 — serializeRefreshCookie·
 * expiredRefreshCookies 같은 원문 함수를 가져와 "기대값"을 계산하면 구현을 자기 자신과
 * 비교하는 허위 통과가 되므로 의도적으로 재사용하지 않는다.
 */
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  WEB_ORIGINS_ENV_KEY,
  WEB_REFRESH_COOKIE,
  WEB_REFRESH_COOKIE_SECURE,
} from '../src/auth/auth.service';
import { createE2eApp, resetDb } from './e2e-app';
import { describeWithDb, e2eDb } from './e2e-db';

const d = describeWithDb();

const ALLOWED_ORIGIN = 'https://watch.gachinol.test'; // RFC 2606 예약 TLD — 실도메인과 충돌 없음
const DISALLOWED_ORIGIN = 'https://evil.example';
const CSRF_HEADER = 'X-Requested-With';
const CSRF_VALUE = 'XMLHttpRequest';

interface ParsedCookie {
  name: string;
  value: string;
  attrs: Record<string, string | true>;
}

/** Set-Cookie 원문 1개 → 이름/값/속성. 구현 함수 재사용 없는 독립 파서(허위 통과 방지). */
function parseSetCookie(raw: string): ParsedCookie {
  const parts = raw.split(';').map((p) => p.trim());
  const first = parts[0] ?? '';
  const eq = first.indexOf('=');
  const name = first.slice(0, eq);
  const value = first.slice(eq + 1);
  const attrs: Record<string, string | true> = {};
  for (const part of parts.slice(1)) {
    const i = part.indexOf('=');
    if (i === -1) attrs[part.toLowerCase()] = true;
    else attrs[part.slice(0, i).toLowerCase()] = part.slice(i + 1);
  }
  return { name, value, attrs };
}

/** superagent 타입 선언은 headers['set-cookie']를 string으로 잡지만 Node는 항상 배열로 준다 */
function setCookies(res: request.Response): string[] {
  const raw = res.headers['set-cookie'] as unknown as string | string[] | undefined;
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

function findCookie(res: request.Response, name: string): ParsedCookie {
  const raw = setCookies(res).find((c) => c.startsWith(`${name}=`));
  if (!raw) {
    throw new Error(
      `Set-Cookie에서 '${name}' 쿠키를 찾지 못했습니다 (실제: ${
        setCookies(res).join(' | ') || '(Set-Cookie 없음)'
      })`,
    );
  }
  return parseSetCookie(raw);
}

d('auth-web (withDb)', () => {
  let app: INestApplication;
  const prevWebOrigins = process.env[WEB_ORIGINS_ENV_KEY];

  const creds = () => ({
    email: e2eDb().adminEmail!,
    password: e2eDb().adminPassword!,
  });

  beforeAll(async () => {
    // WebCsrfGuard가 읽는 오리진 화이트리스트 — WEB_ORIGINS는 config/env.schema.ts(Env) 밖 키라
    // process.env 직접 주입이 유일한 도달 경로다(config.module.ts 주석 참조). configureApp은
    // main.ts의 enableWebCors(app.enableCors)를 타지 않으므로 이 스위트에서 CORS 자체(프리플라이트)는
    // 관심사가 아니다 — 가드는 실제 브라우저 프리플라이트 없이 요청 헤더만으로 판정하므로
    // supertest 직접 호출로도 온전히 검증된다.
    process.env[WEB_ORIGINS_ENV_KEY] = ALLOWED_ORIGIN;
    await resetDb();
    app = await createE2eApp();
  });

  afterAll(async () => {
    await app.close();
    if (prevWebOrigins === undefined) delete process.env[WEB_ORIGINS_ENV_KEY];
    else process.env[WEB_ORIGINS_ENV_KEY] = prevWebOrigins;
  });

  const csrfHeaders = (origin: string = ALLOWED_ORIGIN): Record<string, string> => ({
    [CSRF_HEADER]: CSRF_VALUE,
    Origin: origin,
  });

  const webLogin = () =>
    request(app.getHttpServer()).post('/v1/auth/web/login').set(csrfHeaders()).send(creds());

  describe('Set-Cookie 왕복 + 쿠키 속성 (AC2)', () => {
    it('로그인 성공 — 비보안(HTTP) 컨텍스트: 평문 이름, HttpOnly·SameSite=Lax·Path=/, Secure 없음', async () => {
      const res = await webLogin().expect(200);

      // 바디에는 refresh 원문이 없다 — 이게 웹 전환 자체의 이유(HttpOnly 쿠키 전용, XSS로 안 샌다)
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toBeUndefined();
      expect(res.body.user?.email).toBe(creds().email.toLowerCase());
      expect(res.body.user?.passwordHash).toBeUndefined();

      const cookie = findCookie(res, WEB_REFRESH_COOKIE);
      expect(cookie.value.length).toBeGreaterThan(10); // JWT 원문 — 빈 값이 아님을 실측
      expect(cookie.attrs['httponly']).toBe(true);
      expect(cookie.attrs['samesite']).toBe('Lax');
      expect(cookie.attrs['path']).toBe('/');
      expect(cookie.attrs['secure']).toBeUndefined();
      const maxAge = Number(cookie.attrs['max-age']);
      expect(maxAge).toBeGreaterThan(1_209_000); // ≈14일, 처리 지연 몇 초 허용
      expect(maxAge).toBeLessThanOrEqual(1_209_600);

      // __Host- 이름으로는 발급되지 않는다(비보안 컨텍스트 저하 운용)
      expect(setCookies(res).some((c) => c.startsWith(`${WEB_REFRESH_COOKIE_SECURE}=`))).toBe(
        false,
      );
    });

    it('보안(X-Forwarded-Proto: https) 컨텍스트: __Host- 접두 + Secure', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/web/login')
        .set(csrfHeaders())
        .set('X-Forwarded-Proto', 'https')
        .send(creds())
        .expect(200);

      const cookie = findCookie(res, WEB_REFRESH_COOKIE_SECURE);
      expect(cookie.attrs['secure']).toBe(true);
      expect(cookie.attrs['httponly']).toBe(true);
      expect(cookie.attrs['samesite']).toBe('Lax');
      expect(cookie.attrs['path']).toBe('/');
      // 평문 이름으로는 동시 발급되지 않는다(한쪽만)
      expect(setCookies(res).some((c) => c.startsWith(`${WEB_REFRESH_COOKIE}=`))).toBe(false);
    });

    it('발급된 쿠키만으로(Authorization 헤더 없이) 보호 라우트(web/refresh) 접근 성공', async () => {
      const login = await webLogin().expect(200);
      const cookie = findCookie(login, WEB_REFRESH_COOKIE);

      const res = await request(app.getHttpServer())
        .post('/v1/auth/web/refresh')
        .set(csrfHeaders())
        .set('Cookie', `${cookie.name}=${cookie.value}`)
        // Authorization 헤더 의도적 미부착 — 이게 이 테스트의 핵심 단언
        .expect(200);

      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.refreshToken).toBeUndefined();
      findCookie(res, WEB_REFRESH_COOKIE); // 새 쿠키도 응답에 실려 재발급된다
    });
  });

  describe('CSRF 가드 (AC3)', () => {
    it('X-Requested-With 누락 → 403 forbidden (Origin은 정상) — 컨트롤러 미도달(쿠키 미발급)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/web/login')
        .set('Origin', ALLOWED_ORIGIN)
        .send(creds())
        .expect(403);
      expect(res.body.code).toBe('forbidden');
      expect(setCookies(res)).toHaveLength(0); // 가드가 컨트롤러 전에 막아 쿠키가 아예 안 나간다
    });

    it('Origin·Referer 둘 다 없음 → 403 (커스텀 헤더는 정상)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/web/login')
        .set(CSRF_HEADER, CSRF_VALUE)
        .send(creds())
        .expect(403);
      expect(res.body.code).toBe('forbidden');
    });

    it('허용 목록에 없는 Origin → 403 (커스텀 헤더는 정상 — 오리진 검증 자체를 실측)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/web/login')
        .set(csrfHeaders(DISALLOWED_ORIGIN))
        .send(creds())
        .expect(403);
      expect(res.body.code).toBe('forbidden');
    });

    it('가드는 web/refresh·web/logout에도 부착 — CSRF 헤더 없으면 유효 쿠키가 있어도 403(401 아님)', async () => {
      const login = await webLogin().expect(200);
      const cookie = findCookie(login, WEB_REFRESH_COOKIE);
      const cookieHeader = `${cookie.name}=${cookie.value}`;

      // 가드가 없다면 쿠키 부재/무효로 401이 났을 자리 — 403이 나와야 "가드가 먼저 막았다"가 성립
      const refreshRes = await request(app.getHttpServer())
        .post('/v1/auth/web/refresh')
        .set('Cookie', cookieHeader)
        .expect(403);
      expect(refreshRes.body.code).toBe('forbidden');

      const logoutRes = await request(app.getHttpServer())
        .post('/v1/auth/web/logout')
        .set('Cookie', cookieHeader)
        .expect(403);
      expect(logoutRes.body.code).toBe('forbidden');
    });

    it('바디 방식 기존 라우트(POST /v1/auth/login)는 CSRF 헤더 없이도 200 — 가드 미부착 무회귀', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send(creds())
        .expect(200);
      // 바디 경로는 원래대로 refreshToken을 바디에 담아 돌려준다(웹 경로와의 유일한 정책 차이)
      expect(res.body.tokens.refreshToken).toEqual(expect.any(String));
    });

    it('바디 방식 기존 라우트(POST /v1/auth/refresh)도 CSRF 헤더 없이 동작 — 가드 미부착 무회귀', async () => {
      const login = await request(app.getHttpServer())
        .post('/v1/auth/login')
        .send(creds())
        .expect(200);
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: login.body.tokens.refreshToken })
        .expect(200);
    });
  });

  describe('회전 + 무효화 + 재사용 탐지 (AC4)', () => {
    it('회전 시 새 쿠키로 교체되고, 구 쿠키는 재사용 즉시 401 + 클리어, family 전체 폐기', async () => {
      const login = await webLogin().expect(200);
      const first = findCookie(login, WEB_REFRESH_COOKIE);

      const rotated = await request(app.getHttpServer())
        .post('/v1/auth/web/refresh')
        .set(csrfHeaders())
        .set('Cookie', `${first.name}=${first.value}`)
        .expect(200);
      const second = findCookie(rotated, WEB_REFRESH_COOKIE);
      expect(second.value).not.toBe(first.value); // 회전 확인 — 새 쿠키로 실제 교체됨

      // 구 쿠키 재사용 → 401 + 응답이 쿠키를 지운다(양쪽 이름 모두 Max-Age=0)
      const reused = await request(app.getHttpServer())
        .post('/v1/auth/web/refresh')
        .set(csrfHeaders())
        .set('Cookie', `${first.name}=${first.value}`)
        .expect(401);
      expect(reused.body.code).toBe('unauthorized');
      const cleared = setCookies(reused).map(parseSetCookie);
      expect(cleared).toHaveLength(2);
      expect(cleared.map((c) => c.name).sort()).toEqual(
        [WEB_REFRESH_COOKIE, WEB_REFRESH_COOKIE_SECURE].sort(),
      );
      expect(cleared.every((c) => c.attrs['max-age'] === '0')).toBe(true);

      // 재사용 탐지 = family 전체 폐기 — 방금 정상 발급됐던 신규 쿠키(second)도 이제 401이어야 한다
      const secondNowInvalid = await request(app.getHttpServer())
        .post('/v1/auth/web/refresh')
        .set(csrfHeaders())
        .set('Cookie', `${second.name}=${second.value}`)
        .expect(401);
      expect(secondNowInvalid.body.code).toBe('unauthorized');
    });

    it('로그아웃 → 204 + 쿠키 클리어, 이후 그 쿠키로 refresh 시도하면 401 (AC 범위 밖 보강 커버리지)', async () => {
      const login = await webLogin().expect(200);
      const cookie = findCookie(login, WEB_REFRESH_COOKIE);

      const logoutRes = await request(app.getHttpServer())
        .post('/v1/auth/web/logout')
        .set(csrfHeaders())
        .set('Cookie', `${cookie.name}=${cookie.value}`)
        .expect(204);
      const cleared = setCookies(logoutRes).map(parseSetCookie);
      expect(cleared.length).toBeGreaterThan(0);
      expect(cleared.every((c) => c.attrs['max-age'] === '0')).toBe(true);

      await request(app.getHttpServer())
        .post('/v1/auth/web/refresh')
        .set(csrfHeaders())
        .set('Cookie', `${cookie.name}=${cookie.value}`)
        .expect(401);
    });
  });
});
