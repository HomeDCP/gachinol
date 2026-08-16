import { ResidentUploadStatus } from '@gachinol/shared';
import { isApiClientError, isApiNetworkError } from '../api/errors';
import type { ResidentLinkPublicView } from './resident-link-api';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 업로드 화면의 **판정** — 전부 순수 함수 (T-W2-09)
 *
 * 화면(app/upload/[token].tsx)은 이 파일의 판정 결과를 **렌더만** 한다. 판정을 JSX 안에 직접 쓰면
 * 조용히 무보호가 되기 때문이다(Wave 8a에서 한 웨이브에 3번 겪은 결함).
 *
 * ── 규칙의 원천은 서버다 ────────────────────────────────────────────────────
 * 유효기간(72h)·건수(5)·용량(500MB)·IP 레이트리밋(10회/시간)은 서버 상수
 * (`services/api/src/resident-links/resident-links.constants.ts`)가 강제하고, 03 §C-5가 그 수치의
 * 정본이다. **이 파일에는 그 수치가 하나도 없다** — 화면은 서버 응답의 `maxUploads`·
 * `remainingUploads`·`expiresAt`·`maxFileSizeBytes`를 그대로 보여 준다. 상수를 복사하면 서버가
 * 값을 바꿨을 때 "링크가 서버에 따라 다른 약속을 하는" 상태가 된다.
 * (2026-08-17 실측: `GET /v1/resident-links/:token` → maxUploads=5 · maxFileSizeBytes=524288000.)
 * ══════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── 안내 문구 (정본 문언) ─────────────────────────── */

/**
 * ★★ 검수 게이트 고지 — 03 §C-5 "반드시 지사 담당자 검수를 거쳐야 정식 파이프라인에 진입한다".
 *
 * 이 문장은 **없애면 안 된다**. 무인증 업로더에게 "올리면 바로 방송된다"는 오해를 주면 ① 제보자가
 * 방송 여부를 잘못 예측하고 ② 초상권·불법촬영물 리스크에 대한 사전 인지 기회가 사라진다(07 §3-15).
 * 서버가 실제로 이 게이트를 강제한다: 완료 통지는 미디어 큐를 인큐하지 않고, `uploaded→processing`
 * 엣지가 `assertResidentReviewApproved`로 fail-closed다.
 */
export const REVIEW_GATE_NOTICE =
  '올려주신 영상은 지사 담당자가 확인한 뒤에 방송에 나갑니다. 올리자마자 바로 공개되지는 않습니다.';

/**
 * 간단 모드 강제 고지 — 03 §C-5 "촬영 → 바로 업로드".
 *
 * ⚠️ **"담당자가 제목·분류를 정해 드립니다"라고 쓰지 않는다**(대장 #136): 정본 03 §C-5는 그렇게
 * 약속했지만 서버에는 **제목·분류를 고칠 수 있는 액터가 0명**이다(주민 제보는 reporterId=null이라
 * 어떤 기자도 소유자 판정을 통과하지 못하고, 센터는 송출 채널 지정만 허용되며, 상태 `uploaded`도
 * 수정 허용 집합 밖이다 — 자막만 `PATCH /v1/contents/:id/captions`로 열려 있다). 지켜질 수 없는
 * 약속을 화면이 하지 않도록, 주민이 **직접 확인 가능한 사실**(입력할 것이 없다)만 적는다.
 */
export const SIMPLE_MODE_NOTICE =
  '제목·분류·자막은 입력하지 않으셔도 됩니다. 촬영한 영상만 그대로 올려 주세요.';

/** 07 §3-15 ⓐ — 연락처는 **선택**이며 수집 목적을 함께 적는다(신원 확인 아님·과잉수집 방지) */
export const CONTACT_PURPOSE_NOTICE =
  '연락처는 영상에 문제가 있을 때 연락드리기 위한 것입니다. 적지 않으셔도 올릴 수 있습니다.';

/**
 * ★ 07 §3-15 이용허락 문구 자리 — **지금은 비어 있다**.
 *
 * EXEC-DECISIONS #25가 이 화면을 07 §3-15 착수 게이트의 유효 지점으로 명시했으나("문구 초안이 그
 * 화면의 산출물이다"), 같은 결정의 ③이 "**약관 문구 자체를 코드에 창작해 넣지 않는다** — 문구의
 * 소유자는 외부 법률자문"을 못박았고 외부 법률자문은 아직 미착수(지출 발생 행위, G9 ③ 미확인)다.
 *
 * 그래서 이 값은 `null`이고, `shouldCollectConsent()`가 false를 돌려주는 동안 화면은 **동의
 * 체크박스도 이용허락 문구도 렌더하지 않으며 서버에 `consentAgreed`를 보내지도 않는다**. 서버
 * 스키마가 `consentAgreed`를 optional로 둔 이유와 같다 — "무엇에 동의했는지 모르는 동의"를 받지
 * 않기 위해서다. 확정 문구가 오면 이 상수에 넣는 것만으로 동의 UI가 살아난다(배선은 이미 있다).
 */
export const LEGAL_CONSENT_TEXT: string | null = null;

/** 동의 UI를 렌더할지 — 문구가 실재할 때만 true */
export const shouldCollectConsent = (): boolean => LEGAL_CONSENT_TEXT !== null;

/* ─────────────────────────── 링크 상태 판정 ─────────────────────────── */

export type ResidentLinkGateKind =
  /** URL에 토큰 세그먼트가 없다(직접 타이핑·잘린 링크) */
  | 'missing_token'
  /** 조회 중 */
  | 'loading'
  /** 404 — 형식 오류·미존재를 서버가 동일하게 수렴시킨다(존재 여부 오라클 차단) */
  | 'unknown_link'
  /** valid=false, reason=expired */
  | 'expired'
  /** valid=false, reason=exhausted */
  | 'exhausted'
  /** 업로드 가능 */
  | 'ready'
  /** 그 밖의 실패(네트워크·5xx) — 재시도가 의미 있는 유일한 분기 */
  | 'error';

export interface ResidentLinkGate {
  readonly kind: ResidentLinkGateKind;
  readonly title: string;
  readonly body: string;
  /** ready일 때만 채워진다 — 화면이 이 값 밖의 링크 정보를 그리지 않게 하는 하드가드 */
  readonly view: ResidentLinkPublicView | null;
  /** 재시도 버튼을 보여도 되는 상태인가 (만료·소진·미존재는 재시도해도 결과가 같다) */
  readonly retryable: boolean;
}

/** 안내 문구 — 7종 전수 satisfies(분기가 늘면 tsc가 잡는다) */
const GATE_TEXT = {
  missing_token: {
    title: '링크가 올바르지 않습니다',
    body: '문자·카카오톡으로 받은 주소 전체를 눌러 주세요. 주소가 중간에 잘리면 열리지 않습니다.',
  },
  loading: { title: '링크를 확인하고 있습니다', body: '잠시만 기다려 주세요.' },
  unknown_link: {
    title: '사용할 수 없는 링크입니다',
    body: '주소가 잘못되었거나 이미 사라진 링크입니다. 링크를 보내주신 지사 담당자에게 새 링크를 요청해 주세요.',
  },
  expired: {
    title: '링크 사용 기간이 지났습니다',
    body: '링크를 보내주신 지사 담당자에게 새 링크를 요청해 주세요.',
  },
  exhausted: {
    title: '이 링크로는 더 올릴 수 없습니다',
    body: '올릴 수 있는 횟수를 모두 사용했습니다. 링크를 보내주신 지사 담당자에게 새 링크를 요청해 주세요.',
  },
  ready: { title: '영상 올리기', body: REVIEW_GATE_NOTICE },
  error: {
    title: '링크를 확인하지 못했습니다',
    body: '인터넷 연결을 확인하고 다시 시도해 주세요.',
  },
} as const satisfies Record<ResidentLinkGateKind, { title: string; body: string }>;

export interface ResidentLinkGateInput {
  /** expo-router `useLocalSearchParams()`가 주는 그대로 — 배열·undefined 가능 */
  readonly token: string | string[] | undefined;
  readonly isPending: boolean;
  readonly error: unknown;
  readonly view: ResidentLinkPublicView | undefined;
}

/**
 * ★★ 토큰·링크 상태 판정 — 이 화면의 유일한 게이트.
 *
 * 판정 순서가 곧 안전 순서다: ① 토큰이 없으면 서버를 때리지도 않는다 → ② 404는 "없는 링크"로
 * 수렴(만료·소진과 구분해야 안내가 정확해진다) → ③ 서버가 valid=false로 준 사유를 그대로 존중 →
 * ④ valid=true라야 ready. **`view`는 ready에서만 노출**하므로, 화면이 만료된 링크의 지사명·잔여
 * 건수를 실수로 그릴 방법이 없다.
 */
export function resolveResidentLinkGate(input: ResidentLinkGateInput): ResidentLinkGate {
  const token = normalizeToken(input.token);
  if (!token) return gate('missing_token');

  if (input.error !== undefined && input.error !== null) {
    // 404 = 형식 오류·미존재(서버가 동일 수렴). 그 외 4xx/5xx/네트워크는 재시도 가능한 error다.
    if (isApiClientError(input.error) && input.error.status === 404) return gate('unknown_link');
    return gate('error');
  }

  if (input.isPending || !input.view) return gate('loading');

  if (!input.view.valid) {
    if (input.view.reason === 'expired') return gate('expired');
    if (input.view.reason === 'exhausted') return gate('exhausted');
    // 서버가 valid=false인데 사유를 안 줬다 — 사용 가능으로 오해하게 두지 않는다(fail-closed)
    return gate('unknown_link');
  }

  return gate('ready', input.view);
}

function gate(kind: ResidentLinkGateKind, view: ResidentLinkPublicView | null = null) {
  return {
    kind,
    title: GATE_TEXT[kind].title,
    body: GATE_TEXT[kind].body,
    view,
    retryable: kind === 'error',
  } satisfies ResidentLinkGate;
}

/** expo-router는 같은 이름이 여러 번이면 배열을 준다. 공백만 있는 값은 없는 것으로 본다 */
export function normalizeToken(raw: string | string[] | undefined): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed.length > 0 ? trimmed : null;
}

/* ─────────────────────────── 파일 선택 판정 ─────────────────────────── */

export interface SelectedVideoLike {
  readonly name: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

export type VideoCheck = { readonly ok: true } | { readonly ok: false; readonly message: string };

/**
 * 선택한 파일이 올릴 수 있는 것인지 — **서버가 거절할 것을 미리 알려주는** 용도다(서버 판정 대체
 * 아님: 500MB 초과는 서버가 403, 비디오 아님은 400으로 최종 거절한다). 상한값은 인자로 받는다.
 */
export function checkSelectedVideo(file: SelectedVideoLike, maxFileSizeBytes: number): VideoCheck {
  if (!file.mimeType.startsWith('video/')) {
    return { ok: false, message: '동영상 파일만 올릴 수 있습니다. 촬영한 영상을 골라 주세요.' };
  }
  if (file.sizeBytes <= 0) {
    return { ok: false, message: '파일을 읽지 못했습니다. 다시 골라 주세요.' };
  }
  if (file.sizeBytes > maxFileSizeBytes) {
    return {
      ok: false,
      message: `영상이 너무 큽니다. ${formatMegabytes(maxFileSizeBytes)}까지 올릴 수 있습니다 (고른 영상 ${formatMegabytes(file.sizeBytes)}).`,
    };
  }
  return { ok: true };
}

/* ─────────────────────────── 표시 형식 ─────────────────────────── */

/** 어르신 가독성 — 소수점 없이 MB, 1GB 이상은 GB 한 자리 */
export function formatMegabytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)}GB`;
  return `${Math.max(1, Math.round(mb))}MB`;
}

/** "5번 중 3번 더 올릴 수 있습니다" — '건'보다 '번'이 구어에 가깝다(03 §A 어르신 우선) */
export function formatRemainingUploads(remaining: number, max: number): string {
  if (remaining <= 0) return `${max}번을 모두 사용했습니다`;
  return `${max}번 중 ${remaining}번 더 올릴 수 있습니다`;
}

/**
 * 만료까지 남은 시간 — `now`를 인자로 받는 순수 함수(기기 시계 의존 테스트 금지).
 * 24시간 이상은 "N일", 1시간 이상은 "N시간", 그 미만은 "곧 만료됩니다".
 */
export function formatRemainingTime(expiresAt: string, now: Date): string {
  const ms = new Date(expiresAt).getTime() - now.getTime();
  if (!Number.isFinite(ms) || ms <= 0) return '사용 기간이 지났습니다';
  const hours = Math.floor(ms / 3_600_000);
  if (hours >= 24) return `${Math.floor(hours / 24)}일 남았습니다`;
  if (hours >= 1) return `${hours}시간 남았습니다`;
  return '곧 사용 기간이 끝납니다';
}

/* ─────────────────────────── 업로드 실패 판정 ─────────────────────────── */

/**
 * 업로드 요청 실패 → 사용자 문구.
 *
 * ★ **429는 상태 코드로 판정한다**(2026-08-17 실측): 서버 컨트롤러가 레이트리밋을 순수
 * `HttpException(message, 429)`로 던져 전역 필터가 `ApiError.code`를 `'internal'`로 채운다 —
 * `err.code === 'rate_limited'` 같은 코드 기반 판정은 **영원히 맞지 않는다**.
 * 실측: 11번째 시도 → `HTTP 429 {"code":"internal","message":"업로드 시도가 너무 많습니다…"}`.
 */
export function resolveUploadErrorMessage(err: unknown): string {
  if (isApiClientError(err)) {
    if (err.status === 429) {
      return err.error.message || '조금 뒤에 다시 시도해 주세요.';
    }
    // 403(만료·건수 소진·용량 초과)·400은 서버 한국어 메시지가 이미 정확하다
    if (err.error.message) return err.error.message;
    if (err.status === 404) return '사용할 수 없는 링크입니다. 새 링크를 요청해 주세요.';
    return '올리지 못했습니다. 잠시 뒤에 다시 시도해 주세요.';
  }
  if (isApiNetworkError(err)) return '인터넷 연결이 끊겼습니다. 연결을 확인하고 다시 시도해 주세요.';
  return '올리지 못했습니다. 잠시 뒤에 다시 시도해 주세요.';
}

/* ─────────────────────────── 업로드 완료 판정 ─────────────────────────── */

export interface UploadDoneNotice {
  readonly title: string;
  readonly body: string;
  /** 남은 횟수가 0이면 재업로드 버튼 자체를 없앤다(누를 수 있는데 403이 나는 화면 금지) */
  readonly canUploadMore: boolean;
}

/**
 * 완료 영수증 → 안내. 서버가 돌려주는 상태는 `awaiting_branch_review`(검수 대기)가 정상이며,
 * 그 밖의 값이 오면 **성공이라고 말하지 않는다**(상태를 지어내지 않는다).
 */
export function resolveUploadDoneNotice(receipt: {
  readonly status: ResidentUploadStatus;
  readonly remainingUploads: number;
}): UploadDoneNotice {
  const canUploadMore = receipt.remainingUploads > 0;
  const more = canUploadMore
    ? '더 올리실 영상이 있으면 아래에서 이어서 올릴 수 있습니다.'
    : '이 링크로 올릴 수 있는 횟수를 모두 사용했습니다.';

  if (receipt.status === ResidentUploadStatus.AwaitingBranchReview) {
    return {
      title: '잘 올라갔습니다',
      body: `${REVIEW_GATE_NOTICE} ${more}`,
      canUploadMore,
    };
  }
  return {
    title: '올리기가 끝나지 않았습니다',
    body: '영상이 제대로 도착하지 않았습니다. 다시 시도해 주세요.',
    canUploadMore,
  };
}
