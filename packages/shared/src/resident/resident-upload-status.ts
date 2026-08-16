/* ══════════════════════════════════════════════════════════════════════════
 * 주민 업로드(`resident_uploads`) 1건의 검수 상태 — shared 계약.
 *
 * ★ ContentStatus 23종은 건드리지 않는다. 02 §D-T9의 "`awaiting_branch_review` **상당** 상태"는
 *   Content의 상태가 아니라 이 컬럼(`resident_uploads.status`)이 표현하며, 그 사이 Content 자신은
 *   'uploaded'에 머문다(=미디어 잡 미인큐 = 검수 게이트의 1차 강제 수단).
 *
 *   T-W2-08은 이 계약을 api 모듈 내부(`services/api/src/resident-links/`)에 두었다 — 당시 소비자가
 *   "지사 담당자 검수 화면"(후속 FE 태스크, 미착수) 하나뿐이라 앱·워커가 공유하는 도메인 계약이
 *   아니라고 판단했기 때문이다(distribution의 큐 wire를 api 내부에 둔 선례와 동형이라 봤다).
 *   **T-W2-25a가 그 후속 FE 태스크(T-W2-25b, 기자 앱 검수 화면) 착수를 계기로 shared에 승격했다**
 *   (2026-08-16) — 앱이 이 상태를 소비하는 순간 이것은 앱·서버가 공유하는 계약이고, 리포 CLAUDE.md
 *   §10("공용 타입은 반드시 packages/shared에 두고 앱·서비스가 import — 계약 단일화")을 따른다.
 *
 *   전이 판정 헬퍼(`canTransitionResidentUpload`)와 파이프라인 진입 게이트(`isPipelineEntryAllowed`)는
 *   여전히 api 전용이다(어떤 앱도 호출하지 않는 서버측 판정 로직) — 계속
 *   `services/api/src/resident-links/resident-upload-status.ts`에 남아 있고, 그 파일은 아래 enum·
 *   전이맵을 shared에서 재수출 없이 그대로 소비한다(사본 0).
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
 * 전이 맵 — 규칙의 유일 원천(사본 금지). 판정은 shared `canTransition`(state-machine)을 재사용한다.
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
