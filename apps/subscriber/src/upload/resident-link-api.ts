import type { ResidentUploadStatus } from '@gachinol/shared';
import { ApiClientError, ApiNetworkError } from '../api/errors';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 임시 업로드 링크 — 무인증 HTTP 표면 (T-W2-09, 서버 원천 = T-W2-08)
 *
 * ── 왜 `src/api/client.ts`를 쓰지 않는가 ────────────────────────────────────
 * 구독자 앱의 `PublicApiClient`는 **GET 전용**이다(`get<TRes>(path)` 하나뿐 — 익명 시청 피드가
 * 유일한 소비자였다). 이 화면은 POST 2종이 필요하고, `client.ts`는 이 태스크의 파일 소유 밖이라
 * 확장할 수 없다. 그래서 여기에 **이 표면 전용**의 최소 요청기를 둔다 — 에러 타입(`ApiClientError`·
 * `ApiNetworkError`)은 기존 것을 그대로 재사용해 화면 공통 처리(`userMessageForError`)와 정합한다.
 *
 * ── 응답 타입이 shared에 없는 이유 ─────────────────────────────────────────
 * 서버가 `services/api/src/resident-links/resident-links.service.ts`에 이 3종을 정의하며, 그 파일
 * 상단 주석이 "이 표면의 소비자는 구독자 웹의 무인증 업로드 화면(T-W2-09) 하나뿐이고 앱·워커가
 * 공유하는 도메인 계약이 아니다"라고 shared 미승격을 명시했다. 따라서 여기 인터페이스는 **서버를
 * 원천으로 하는 미러**다(기자 앱 `src/api/resident-uploads.ts`가 `ResidentUploadReviewItem`을
 * 미러하는 것과 동형). 단 `ResidentUploadStatus`는 T-W2-25a가 shared로 승격했으므로 재정의하지 않고
 * import한다(사본 0).
 *
 * ── 토큰 취급 (무인증 표면의 유일한 자격 증명) ──────────────────────────────
 * 토큰은 **URL 경로 세그먼트로만** 존재한다. 이 모듈은 토큰을 로그·에러 메시지·쿼리스트링·헤더
 * 어디에도 싣지 않는다. 던지는 에러는 서버가 준 `ApiError`(토큰 미포함)뿐이다.
 * ══════════════════════════════════════════════════════════════════════════ */

/** GET /v1/resident-links/:token — 화이트리스트 투영(발급자·내부 id 없음) */
export interface ResidentLinkPublicView {
  readonly valid: boolean;
  /** valid=false일 때만 — 만료인지 소진인지에 따라 안내가 달라진다 */
  readonly reason?: 'expired' | 'exhausted';
  readonly stationName: string;
  readonly expiresAt: string;
  readonly maxUploads: number;
  readonly remainingUploads: number;
  /** ★ 용량 상한의 **유일 원천은 서버 응답**이다 — 화면에 500MB를 상수로 박지 않는다 */
  readonly maxFileSizeBytes: number;
}

/** POST /v1/resident-links/:token/uploads — presigned PUT 발급 */
export interface ResidentUploadTicket {
  readonly uploadId: string;
  readonly uploadUrl: string;
  readonly uploadUrlExpiresAt: string;
  readonly remainingUploads: number;
  readonly maxFileSizeBytes: number;
}

/** POST /v1/resident-links/:token/uploads/:uploadId/complete — 검수 대기열 편입 */
export interface ResidentUploadReceipt {
  readonly uploadId: string;
  readonly status: ResidentUploadStatus;
  readonly remainingUploads: number;
}

/**
 * 요청 바디 — 서버 zod(`zResidentUploadRequest`)와 1:1.
 * ★ 제목·분류·자막 필드가 **없다**: 간단 모드 강제(03 §C-5)의 서버측 반영이 "그 입력을 받는 필드가
 *   아예 없다"이므로, 클라이언트가 보낼 수 있는 형태 자체가 존재하지 않는다.
 */
export interface ResidentUploadRequest {
  readonly fileName: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  /** 07 §3-15 ⓐ — 선택. 사후 연락 가능성 확보용이며 신원 확인이 아니다 */
  readonly uploaderContact?: string;
  /** 07 §3-15 ⓑ — 동의 **문구가 확정된 뒤에만** 실린다(gate.ts `LEGAL_CONSENT_TEXT` 참조) */
  readonly consentAgreed?: boolean;
}

export interface ResidentLinkApiDeps {
  /** getApiBaseUrl() — '/v1'은 이 모듈이 붙인다 */
  readonly baseUrl: string;
  /** 기본 globalThis.fetch (테스트 주입점) */
  readonly fetchFn?: typeof fetch;
  /** 기본 20초 — 업로드 자체가 아니라 제어 요청의 타임아웃이다 */
  readonly timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 20_000;

async function request<TRes>(
  deps: ResidentLinkApiDeps,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<TRes> {
  const fetchFn: typeof fetch = deps.fetchFn ?? ((...args) => globalThis.fetch(...args));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetchFn(`${deps.baseUrl}/v1${path}`, {
      method,
      headers: body
        ? { Accept: 'application/json', 'Content-Type': 'application/json' }
        : { Accept: 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: controller.signal,
    });
  } catch (cause) {
    // ★ cause를 메시지에 풀어쓰지 않는다 — fetch 예외 메시지에는 요청 URL(=토큰)이 실릴 수 있다
    throw new ApiNetworkError('서버에 연결할 수 없습니다', { cause });
  } finally {
    clearTimeout(timer);
  }

  if (res.ok) return (await res.json()) as TRes;

  let error = { code: 'internal' as const, message: '' };
  try {
    const parsed = (await res.json()) as { code?: unknown; message?: unknown };
    if (typeof parsed.code === 'string' && typeof parsed.message === 'string') {
      error = { code: parsed.code as 'internal', message: parsed.message };
    }
  } catch {
    // 비JSON 에러 바디 — 합성 폴백 유지(상태 코드만으로도 화면 판정은 성립한다)
  }
  throw new ApiClientError(res.status, error);
}

/** 경로 세그먼트로 안전하게 — 토큰은 base64url이라 실제로는 변형되지 않지만 조립 규율을 지킨다 */
const seg = (v: string): string => encodeURIComponent(v);

export function describeResidentLink(
  deps: ResidentLinkApiDeps,
  token: string,
): Promise<ResidentLinkPublicView> {
  return request<ResidentLinkPublicView>(deps, 'GET', `/resident-links/${seg(token)}`);
}

export function createResidentUpload(
  deps: ResidentLinkApiDeps,
  token: string,
  body: ResidentUploadRequest,
): Promise<ResidentUploadTicket> {
  return request<ResidentUploadTicket>(deps, 'POST', `/resident-links/${seg(token)}/uploads`, body);
}

export function completeResidentUpload(
  deps: ResidentLinkApiDeps,
  token: string,
  uploadId: string,
): Promise<ResidentUploadReceipt> {
  return request<ResidentUploadReceipt>(
    deps,
    'POST',
    `/resident-links/${seg(token)}/uploads/${seg(uploadId)}/complete`,
  );
}
