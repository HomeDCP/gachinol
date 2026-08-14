import type { ProgramCategory } from '@gachinol/shared';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 임시 업로드 링크 — 제약치 정본 반영 (T-W2-08).
 *
 * 03 §C-5가 **수치의 정본**이다(72시간 만료 · 링크당 5건 · 건당 500MB · 동일 IP 시간당 업로드 시도
 * 10회). 이 값들은 **env 키로 승격하지 않는다** — 계획 문서가 확정한 정책 수치라 배포마다 달라지면
 * 안 되고(같은 링크가 서버에 따라 다른 약속을 하게 된다), 이 태스크의 파일 소유권상 `config/env.schema.ts`
 * 확장도 금지다. telemetry가 `TELEMETRY_RATE_LIMIT_CAPACITY`를 고정 명명 상수로 둔 선례와 동형이다.
 *
 * 값을 바꾸려면 03 §C-5부터 고친다(코드가 아니라 문서가 원천).
 * ══════════════════════════════════════════════════════════════════════════ */

/** 링크 유효기간 — 발급 후 72시간(03 §C-5) */
export const RESIDENT_LINK_TTL_MS = 72 * 60 * 60 * 1000;

/** 링크당 업로드 건수 상한 — 5건(03 §C-5). 발급 시점 값을 행(max_uploads)에 스냅샷한다 */
export const RESIDENT_LINK_MAX_UPLOADS = 5;

/** 파일 크기(건당) 상한 — 500MB(03 §C-5). 신고값(발급 시)과 HEAD 실측값(완료 시) 양쪽에서 검증 */
export const RESIDENT_UPLOAD_MAX_BYTES = 500 * 1024 * 1024;

/**
 * zod 입력 경계의 절대 상한 — **500MB 초과를 여기서 막지 않는다**.
 * 02 §D-T9가 "건당 500MB 상한 … 초과 시 403"이라고 못박았으므로 500MB 초과는 400(validation_failed)이
 * 아니라 403(forbidden)이어야 한다 → zod는 터무니없는 값만 걸러내고 실제 상한 판정은 서비스가 한다.
 */
export const RESIDENT_UPLOAD_DECLARED_SIZE_CEILING = 64 * 1024 ** 3;

/* ── IP 레이트리밋 (동일 IP 시간당 업로드 시도 10회 초과 시 차단) ───────────────
 * 토큰버킷 구현·클라이언트 IP 해석은 `telemetry/telemetry-rate-limiter.ts`를 **재사용**한다
 * (복사 금지 — 그 파일의 CF-Connecting-IP 신뢰 순위 주석이 이 모듈에도 그대로 적용된다). */

/** 버스트 허용량 = 시간당 허용 횟수(10). 소진 후에는 아래 refill 간격으로만 회복 */
export const RESIDENT_UPLOAD_RATE_LIMIT_CAPACITY = 10;
/** 토큰 1개 회복 간격 — 3600초/10회 = 360초. 지속 처리율이 정확히 10회/시간/IP가 된다 */
export const RESIDENT_UPLOAD_RATE_LIMIT_REFILL_MS = 360_000;
/** 동시 추적 IP 상한 — 도달 시 신규 키는 거절(레지스트리 자체의 무한 증가·키 회전 우회 봉쇄) */
export const RESIDENT_UPLOAD_RATE_LIMIT_MAX_IPS = 10_000;
/** 유휴 버킷 청소 임계 — refill 주기(6분)보다 충분히 크게(2시간) */
export const RESIDENT_UPLOAD_RATE_LIMIT_IDLE_TTL_MS = 2 * 60 * 60_000;
/** 스윕 최소 간격 */
export const RESIDENT_UPLOAD_RATE_LIMIT_SWEEP_INTERVAL_MS = 5 * 60_000;

/**
 * 미검수 원본의 스토리지 프리픽스 — `resident-uploads/{uploadId}/original.{ext}`.
 * 정식 콘텐츠 프리픽스(`contents/{contentId}/g{n}/`) **밖**에 둔다: ① 업로드 시점에는 아직 Content가
 * 없고(검수 대기열 편입 = 완료 통지 시점), ② 검수 전 무인증 업로드물을 정식 자산과 물리적으로 분리해
 * 두면 반려·정리(수명주기 규칙) 대상을 프리픽스만으로 특정할 수 있다.
 */
export const RESIDENT_UPLOAD_KEY_PREFIX = 'resident-uploads';

/**
 * 검수 대기 콘텐츠의 기본 제목.
 * 03 §C-5 간단 모드는 주민에게 **제목·분류·자막을 요구하지 않는다**(전부 지사 담당자 사후 입력) —
 * 그래서 서버도 주민 입력 제목을 받지 않고 이 고정 문구로 만든다(익명 자유 텍스트 표면도 함께 줄어든다).
 */
export const RESIDENT_UPLOAD_DEFAULT_TITLE = '주민 제보 영상';

/**
 * 검수 대기 콘텐츠의 기본 분류 — 'news'.
 * 분류는 지사 담당자가 사후 입력(03 §C-5)이지만 컬럼은 NOT NULL이라 초기값이 필요하다.
 * 'news'는 `REVIEW_POLICY_DEFAULTS`상 `reporter_then_center`(센터 게이트)로 매핑되는 **가장 보수적인**
 * 선택이라, 검수 담당자가 분류를 바꾸지 않고 흘려보내도 무인증 업로드물이 센터 검토를 건너뛰지 않는다.
 */
export const RESIDENT_UPLOAD_DEFAULT_CATEGORY: ProgramCategory = 'news';
