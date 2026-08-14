import { canTransition, ContentOrigin } from '@gachinol/shared';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 업로드 1건의 상태 — **모듈 내부 계약**(shared 미노출).
 *
 * ★ ContentStatus 23종은 건드리지 않는다. 02 §D-T9의 "`awaiting_branch_review` **상당** 상태"는
 *   Content의 상태가 아니라 이 컬럼(`resident_uploads.status`)이 표현하며, 그 사이 Content 자신은
 *   'uploaded'에 머문다(=미디어 잡 미인큐 = 검수 게이트의 1차 강제 수단).
 *   전이맵을 shared에 올리지 않는 이유: 어떤 앱·워커도 이 상태를 wire로 주고받지 않는다
 *   (distribution의 큐 wire를 api 내부에 둔 선례와 동형).
 * ══════════════════════════════════════════════════════════════════════════ */

export const ResidentUploadStatus = {
  /** presigned PUT 발급 완료 — 오브젝트 도착 대기(슬롯 1개 소비 상태) */
  Pending: 'pending',
  /** 완료 통지 시 오브젝트 부재·크기 초과 — 슬롯은 반환된다 [종결] */
  UploadFailed: 'upload_failed',
  /** ★ 지사 담당자 검수 대기열 편입(= 02 §D-T9의 awaiting_branch_review 상당) */
  AwaitingBranchReview: 'awaiting_branch_review',
  /** 검수 승인 — 이 상태에서만 정식 파이프라인 진입이 허용된다 */
  Approved: 'approved',
  /** 검수 반려 [종결] */
  Rejected: 'rejected',
} as const;
export type ResidentUploadStatus = (typeof ResidentUploadStatus)[keyof typeof ResidentUploadStatus];

/**
 * 전이 맵 — 규칙의 유일 원천(사본 금지). 판정은 shared `canTransition`을 재사용한다.
 * upload_failed는 종결이다: 재시도는 같은 행의 되살림이 아니라 **새 슬롯**(새 업로드)으로 한다
 * (되살리면 소비 카운터와 행 수가 어긋난다).
 */
export const RESIDENT_UPLOAD_STATUS_TRANSITIONS = {
  pending: ['awaiting_branch_review', 'upload_failed'],
  upload_failed: [],
  awaiting_branch_review: ['approved', 'rejected'],
  approved: [],
  rejected: [],
} as const satisfies Record<ResidentUploadStatus, readonly ResidentUploadStatus[]>;

export const canTransitionResidentUpload = (
  from: ResidentUploadStatus,
  to: ResidentUploadStatus,
): boolean => canTransition(RESIDENT_UPLOAD_STATUS_TRANSITIONS, from, to);

/**
 * ★★ 검수 게이트의 순수 판정 (03 §C-5 "지사 담당자 승인 필수, 미승인 콘텐츠는 정식 파이프라인 미진입").
 *
 * - origin이 'resident_link'가 **아니면** 이 게이트의 대상이 아니다 → 항상 허용(기존 경로 무영향).
 * - origin이 'resident_link'이면 **승인된 업로드 행이 있을 때만** 허용한다. 업로드 행이 아예 없는
 *   경우(uploadStatus=null)도 거절이다 — "판정 근거가 없음"을 통과로 해석하면 게이트가 무의미해진다
 *   (fail-closed).
 *
 * I/O가 없는 순수 함수라 DB·Nest 없이 전수 검증할 수 있다(`assertPipelineEntryAllowed`가 유일 소비자).
 */
export const isPipelineEntryAllowed = (origin: string, uploadStatus: string | null): boolean => {
  if (origin !== ContentOrigin.ResidentLink) return true;
  return uploadStatus === ResidentUploadStatus.Approved;
};
