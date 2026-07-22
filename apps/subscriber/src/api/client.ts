import type { ApiError } from '@gachinol/shared';
import { ApiClientError, ApiNetworkError } from './errors';

const DEFAULT_TIMEOUT_MS = 15_000;

export interface PublicApiClientDeps {
  /** getApiBaseUrl() — '/v1'은 클라이언트가 붙인다 */
  baseUrl: string;
  /** 기본 globalThis.fetch */
  fetchFn?: typeof fetch;
  /** 기본 15000 (AbortController) */
  timeoutMs?: number;
}

export interface RequestOptions {
  /** undefined 키 생략 */
  query?: Record<string, string | number | undefined>;
}

/**
 * 익명 GET 전용 공개 클라이언트.
 * reporter/control-center 클라이언트에서 tokenStore·Authorization·refresh·single-flight·401 재시도를
 * 전부 제거했다 — 구독자 피드는 완전 익명(@Public)이라 인증 헤더가 없다.
 */
export interface PublicApiClient {
  get<TRes>(path: string, opts?: RequestOptions): Promise<TRes>;
}

function buildQueryString(query?: Record<string, string | number | undefined>): string {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function createPublicApiClient(deps: PublicApiClientDeps): PublicApiClient {
  const fetchFn: typeof fetch = deps.fetchFn ?? ((...args) => globalThis.fetch(...args));
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /** 네트워크·타임아웃 예외를 ApiNetworkError로 통일 */
  async function doFetch(url: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      // 요청 바디 없음 — Accept 헤더만. Authorization 절대 미부착(익명).
      return await fetchFn(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });
    } catch (cause) {
      throw new ApiNetworkError('서버에 연결할 수 없습니다', { cause });
    } finally {
      clearTimeout(timer);
    }
  }

  async function parseResponse<TRes>(res: Response): Promise<TRes> {
    if (res.ok) {
      // 런타임 재검증 없음 — 서버가 zod로 보장하는 shared 계약 신뢰
      return (await res.json()) as TRes;
    }
    let error: ApiError = { code: 'internal', message: '응답 파싱 실패' };
    try {
      const body = (await res.json()) as unknown;
      if (
        body !== null &&
        typeof body === 'object' &&
        typeof (body as ApiError).code === 'string' &&
        typeof (body as ApiError).message === 'string'
      ) {
        error = body as ApiError;
      }
    } catch {
      // 비JSON 에러 바디 — 합성 폴백 유지
    }
    throw new ApiClientError(res.status, error);
  }

  async function get<TRes>(path: string, opts: RequestOptions = {}): Promise<TRes> {
    const url = `${deps.baseUrl}/v1${path}${buildQueryString(opts.query)}`;
    const res = await doFetch(url);
    return parseResponse<TRes>(res);
  }

  return { get };
}
