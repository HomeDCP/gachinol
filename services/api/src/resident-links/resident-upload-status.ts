import {
  canTransition,
  ContentOrigin,
  RESIDENT_UPLOAD_STATUS_TRANSITIONS,
  ResidentUploadStatus,
} from '@gachinol/shared';

/* ══════════════════════════════════════════════════════════════════════════
 * 주민 업로드 1건의 검수 판정 — **모듈 내부 계약**(api 전용, shared 미노출).
 *
 * `ResidentUploadStatus`·`RESIDENT_UPLOAD_STATUS_TRANSITIONS`(enum·전이맵 자체)는
 * `@gachinol/shared`(`packages/shared/src/resident/resident-upload-status.ts`)가 유일 원천이다
 * — T-W2-25a에서 승격했다(사유·시점은 그 파일 상단 주석). 이 파일에 남은 것은 그 계약을 소비하는
 * **api 전용** 판정 로직뿐이다: 전이 판정 헬퍼(`canTransitionResidentUpload`)와 파이프라인 진입
 * 게이트(`isPipelineEntryAllowed`)는 어떤 앱도 호출하지 않는 서버측 로직이라 여기 남아 있다.
 * ══════════════════════════════════════════════════════════════════════════ */

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
