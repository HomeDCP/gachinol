import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { WebCsrfGuard } from './auth.controller';
import {
  buildWebCorsOptions,
  expiredRefreshCookies,
  hasCsrfHeader,
  isAllowedWebOrigin,
  isSecureCookieContext,
  parseCookieHeader,
  parseWebOrigins,
  readWebRefreshCookie,
  requestOrigin,
  serializeRefreshCookie,
  WEB_REFRESH_COOKIE,
  WEB_REFRESH_COOKIE_SECURE,
} from './auth.service';

/**
 * 웹 세션 보안 원시 — 쿠키 속성·CSRF·CORS 화이트리스트.
 * 이 파일이 지키는 불변식은 3개다: ① refresh 쿠키는 JS가 못 읽고 host-only다
 * ② 쿠키 경로는 커스텀 헤더+허용 오리진 둘 다여야 열린다 ③ WEB_ORIGINS 미설정 = 전면 차단.
 */
describe('parseWebOrigins — WEB_ORIGINS 화이트리스트 파싱', () => {
  it('쉼표·공백 혼합 구분, trailing slash·대문자 호스트 정규화, 중복 제거', () => {
    const { allowed, invalid } = parseWebOrigins(
      'https://watch.gachinol.kr/, https://WATCH.gachinol.kr  https://center.gachinol.kr',
    );
    expect(allowed).toEqual(['https://watch.gachinol.kr', 'https://center.gachinol.kr']);
    expect(invalid).toEqual([]);
  });

  it('포트는 오리진의 일부라 보존한다(로컬 웹 dev 서버)', () => {
    expect(parseWebOrigins('http://localhost:8081').allowed).toEqual(['http://localhost:8081']);
  });

  // 이 케이스가 이 함수의 존재 이유 — credentials 허용 CORS에서 '*'는 스펙상으로도 금지다
  it("와일드카드 '*'는 허용이 아니라 invalid로 떨어진다(전면 허용 금지)", () => {
    const { allowed, invalid } = parseWebOrigins('*');
    expect(allowed).toEqual([]);
    expect(invalid).toEqual(['*']);
  });

  it('경로·쿼리·자격증명·비 http(s) 스킴은 invalid', () => {
    const { allowed, invalid } = parseWebOrigins(
      'https://a.kr/path, https://b.kr?x=1, https://u:p@c.kr, file:///etc, capacitor://d.kr',
    );
    expect(allowed).toEqual([]);
    expect(invalid).toHaveLength(5);
  });

  it('미설정·빈 문자열 → 허용 0건', () => {
    expect(parseWebOrigins(undefined).allowed).toEqual([]);
    expect(parseWebOrigins('   ,  ').allowed).toEqual([]);
  });
});

describe('buildWebCorsOptions — CORS 실패 모드', () => {
  const RAW = 'https://watch.gachinol.kr,https://reporter.gachinol.kr';

  // 안전 기본값: 미설정이면 enableCors 자체를 하지 않는다(= 브라우저 크로스오리진 전면 차단)
  it('WEB_ORIGINS 미설정·전건 무효 → null(전면 차단, 현행 동작 무회귀)', () => {
    expect(buildWebCorsOptions(undefined)).toBeNull();
    expect(buildWebCorsOptions('')).toBeNull();
    expect(buildWebCorsOptions('*')).toBeNull();
  });

  it('화이트리스트 오리진만 반사, 나머지·오리진 없음은 거부', () => {
    const options = buildWebCorsOptions(RAW);
    const origin = options?.origin as (
      o: string | undefined,
      cb: (e: Error | null, allow?: boolean) => void,
    ) => void;

    const decide = (o: string | undefined): boolean | undefined => {
      let result: boolean | undefined;
      origin(o, (_e, allow) => {
        result = allow as boolean;
      });
      return result;
    };

    expect(decide('https://watch.gachinol.kr')).toBe(true);
    expect(decide('https://reporter.gachinol.kr')).toBe(true);
    expect(decide('https://evil.kr')).toBe(false);
    expect(decide('https://watch.gachinol.kr.evil.kr')).toBe(false); // 접두 매칭 아님
    expect(decide(undefined)).toBe(false); // 서버간·curl 호출엔 CORS 헤더 없음
  });

  it('credentials 허용 + CSRF 커스텀 헤더가 allowedHeaders에 있다(프리플라이트 통과 조건)', () => {
    const options = buildWebCorsOptions(RAW);
    expect(options?.credentials).toBe(true);
    expect(options?.allowedHeaders).toContain('X-Requested-With');
    expect(options?.allowedHeaders).toContain('Authorization');
  });
});

describe('refresh 쿠키 속성', () => {
  it('보안 컨텍스트 → __Host- 접두 + Secure + Path=/ + HttpOnly + SameSite=Lax', () => {
    const c = serializeRefreshCookie('jwt.token.value', { secure: true, maxAgeSec: 1209600 });
    expect(c.startsWith(`${WEB_REFRESH_COOKIE_SECURE}=jwt.token.value`)).toBe(true);
    expect(c).toContain('Path=/'); // __Host- 요건
    expect(c).toContain('HttpOnly'); // JS 접근 차단 = 웹 전환의 이유
    expect(c).toContain('SameSite=Lax');
    expect(c).toContain('Max-Age=1209600');
    expect(c).toContain('Secure');
    expect(c).not.toContain('Domain='); // host-only — 형제 서브도메인에 새지 않는다
  });

  it('비보안(로컬 http) → 접두·Secure 없이 저하 운용(브라우저가 __Host-를 저장하지 않으므로)', () => {
    const c = serializeRefreshCookie('t', { secure: false, maxAgeSec: 60 });
    expect(c.startsWith(`${WEB_REFRESH_COOKIE}=t`)).toBe(true);
    expect(c).not.toContain('Secure');
  });

  it('만료 시각이 이미 지났으면 Max-Age는 음수가 아니라 0', () => {
    expect(serializeRefreshCookie('t', { secure: false, maxAgeSec: -5 })).toContain('Max-Age=0');
  });

  // Max-Age=NaN은 잘못된 속성이고, 0으로 대체하면 방금 발급한 세션이 즉시 지워진다
  it('Max-Age 계산 불가(NaN) → 속성 생략(세션 쿠키로 저하)', () => {
    const c = serializeRefreshCookie('t', { secure: false, maxAgeSec: Number.NaN });
    expect(c).not.toContain('Max-Age');
    expect(c).toContain('HttpOnly');
  });

  it('클리어는 두 이름 모두 만료시킨다(http↔https 전환 잔여 쿠키가 401을 고착시키지 않도록)', () => {
    const cleared = expiredRefreshCookies();
    expect(cleared).toHaveLength(2);
    expect(cleared[0]).toContain(`${WEB_REFRESH_COOKIE_SECURE}=`);
    expect(cleared[0]).toContain('Secure');
    expect(cleared[1]).toContain(`${WEB_REFRESH_COOKIE}=`);
    expect(cleared.every((c) => c.includes('Max-Age=0'))).toBe(true);
  });

  it('Secure 판정 — production은 항상, 그 외는 x-forwarded-proto=https일 때만', () => {
    expect(isSecureCookieContext({}, 'production')).toBe(true);
    expect(isSecureCookieContext({ 'x-forwarded-proto': 'https,http' }, 'development')).toBe(true);
    expect(isSecureCookieContext({}, 'development')).toBe(false);
  });
});

describe('쿠키 파싱 — 토싱(동명 중복) 방어', () => {
  it('다른 쿠키가 섞여 있어도 refresh 쿠키만 정확히 뽑는다', () => {
    const header = `theme=dark; ${WEB_REFRESH_COOKIE}=abc.def; lang=ko`;
    expect(readWebRefreshCookie(header)).toBe('abc.def');
  });

  it('쿠키 없음 → null (예외 아님)', () => {
    expect(readWebRefreshCookie(undefined)).toBeNull();
    expect(readWebRefreshCookie('theme=dark')).toBeNull();
  });

  // 형제 서브도메인이 상위 도메인 쿠키를 밀어 넣는 세션 고정 시도 — 어느 쪽이 먼저 올지 보장이 없다
  it('동명 쿠키 중복 → 401(세션 고정 시도로 간주)', () => {
    expect(() =>
      readWebRefreshCookie(`${WEB_REFRESH_COOKIE}=mine; ${WEB_REFRESH_COOKIE}=tossed`),
    ).toThrow(expect.objectContaining({ code: 'unauthorized' }) as unknown as Error);
  });

  it('__Host- 이름과 평문 이름이 동시에 오면 역시 401', () => {
    expect(() =>
      readWebRefreshCookie(`${WEB_REFRESH_COOKIE_SECURE}=a; ${WEB_REFRESH_COOKIE}=b`),
    ).toThrow(expect.objectContaining({ code: 'unauthorized' }) as unknown as Error);
  });

  it('parseCookieHeader는 동명 값을 배열로 보존한다', () => {
    expect(parseCookieHeader('a=1; a=2; b=3').get('a')).toEqual(['1', '2']);
  });

  it('깨진 퍼센트 인코딩 → 500이 아니라 401로 수렴', () => {
    expect(() => readWebRefreshCookie(`${WEB_REFRESH_COOKIE}=%E0%A4%A`)).toThrow(
      expect.objectContaining({ code: 'unauthorized' }) as unknown as Error,
    );
  });
});

describe('requestOrigin / hasCsrfHeader', () => {
  it('Origin 우선, 없으면 Referer에서 오리진 파생', () => {
    expect(requestOrigin({ origin: 'https://watch.gachinol.kr' })).toBe(
      'https://watch.gachinol.kr',
    );
    expect(requestOrigin({ referer: 'https://watch.gachinol.kr/watch/123?x=1' })).toBe(
      'https://watch.gachinol.kr',
    );
  });

  it("불투명 오리진('null')·둘 다 없음 → null", () => {
    expect(requestOrigin({ origin: 'null' })).toBeNull();
    expect(requestOrigin({})).toBeNull();
  });

  it('커스텀 헤더는 존재+비어있지 않아야 인정', () => {
    expect(hasCsrfHeader({ 'x-requested-with': 'XMLHttpRequest' })).toBe(true);
    expect(hasCsrfHeader({ 'x-requested-with': '  ' })).toBe(false);
    expect(hasCsrfHeader({})).toBe(false);
  });

  it('isAllowedWebOrigin은 화이트리스트 대조 — 미설정이면 무엇도 허용하지 않는다', () => {
    expect(isAllowedWebOrigin('https://a.kr', 'https://a.kr')).toBe(true);
    expect(isAllowedWebOrigin('https://a.kr/', 'https://a.kr')).toBe(true);
    expect(isAllowedWebOrigin('https://a.kr', undefined)).toBe(false);
    expect(isAllowedWebOrigin(null, 'https://a.kr')).toBe(false);
  });
});

describe('WebCsrfGuard — 쿠키 경로 전용', () => {
  const ALLOWED = 'https://watch.gachinol.kr';

  const guard = (raw?: string) => new WebCsrfGuard({ get: () => raw } as unknown as ConfigService);

  const ctx = (headers: Record<string, string>): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    }) as unknown as ExecutionContext;

  const forbidden = expect.objectContaining({ code: 'forbidden' }) as unknown as Error;

  it('커스텀 헤더 + 허용 오리진 → 통과', () => {
    expect(
      guard(ALLOWED).canActivate(ctx({ 'x-requested-with': 'XMLHttpRequest', origin: ALLOWED })),
    ).toBe(true);
  });

  // form POST·img 태그로는 커스텀 헤더를 붙일 수 없다 = 고전 CSRF 차단
  it('커스텀 헤더 없음 → 403', () => {
    expect(() => guard(ALLOWED).canActivate(ctx({ origin: ALLOWED }))).toThrow(forbidden);
  });

  it('허용 목록에 없는 오리진 → 403(SameSite가 못 막는 형제 서브도메인發 요청 차단)', () => {
    expect(() =>
      guard(ALLOWED).canActivate(
        ctx({ 'x-requested-with': 'XMLHttpRequest', origin: 'https://go.gachinol.kr' }),
      ),
    ).toThrow(forbidden);
  });

  it('Origin 부재 시 Referer로 판정한다(일부 브라우저는 동일 오리진에 Origin 미전송)', () => {
    expect(
      guard(ALLOWED).canActivate(
        ctx({ 'x-requested-with': 'XMLHttpRequest', referer: `${ALLOWED}/login` }),
      ),
    ).toBe(true);
  });

  it('Origin·Referer 둘 다 없음 → 403(비브라우저 호출은 바디 경로를 쓴다)', () => {
    expect(() => guard(ALLOWED).canActivate(ctx({ 'x-requested-with': 'XMLHttpRequest' }))).toThrow(
      forbidden,
    );
  });

  // CORS 실패 모드와 같은 방향 — 미설정이면 쿠키 경로 자체가 닫힌다
  it('WEB_ORIGINS 미설정 → 무엇도 통과하지 못한다', () => {
    expect(() =>
      guard(undefined).canActivate(ctx({ 'x-requested-with': 'XMLHttpRequest', origin: ALLOWED })),
    ).toThrow(forbidden);
  });
});
