import { ContentOrigin } from '@gachinol/shared';
import {
  canTransitionResidentUpload,
  isPipelineEntryAllowed,
  RESIDENT_UPLOAD_STATUS_TRANSITIONS,
  ResidentUploadStatus,
} from './resident-upload-status';

describe('ResidentUploadStatus 전이 맵', () => {
  it('pending에서만 완료·실패로 갈라지고, 종결 상태는 출구가 없다', () => {
    expect(canTransitionResidentUpload('pending', 'awaiting_branch_review')).toBe(true);
    expect(canTransitionResidentUpload('pending', 'upload_failed')).toBe(true);
    expect(canTransitionResidentUpload('pending', 'approved')).toBe(false); // 검수 건너뛰기 금지
    expect(canTransitionResidentUpload('awaiting_branch_review', 'approved')).toBe(true);
    expect(canTransitionResidentUpload('awaiting_branch_review', 'rejected')).toBe(true);
    expect(canTransitionResidentUpload('upload_failed', 'pending')).toBe(false); // 재시도는 새 슬롯
    expect(canTransitionResidentUpload('rejected', 'approved')).toBe(false);
  });

  it('맵은 5종 전수를 키로 가진다(satisfies가 컴파일 타임에도 강제)', () => {
    expect(Object.keys(RESIDENT_UPLOAD_STATUS_TRANSITIONS).sort()).toEqual(
      Object.values(ResidentUploadStatus).sort(),
    );
  });
});

/* ★★ AC4 — 03 §C-5 "지사 담당자 승인 필수, 미승인 콘텐츠는 정식 파이프라인 미진입"의 순수 판정부 */
describe('isPipelineEntryAllowed (검수 게이트 판정)', () => {
  it('origin=resident_link는 approved일 때만 허용', () => {
    expect(isPipelineEntryAllowed(ContentOrigin.ResidentLink, 'approved')).toBe(true);
    expect(isPipelineEntryAllowed(ContentOrigin.ResidentLink, 'awaiting_branch_review')).toBe(false);
    expect(isPipelineEntryAllowed(ContentOrigin.ResidentLink, 'pending')).toBe(false);
    expect(isPipelineEntryAllowed(ContentOrigin.ResidentLink, 'rejected')).toBe(false);
    expect(isPipelineEntryAllowed(ContentOrigin.ResidentLink, 'upload_failed')).toBe(false);
  });

  it('★ 판정 근거가 없으면(업로드 행 부재) 거절한다 — fail-closed', () => {
    expect(isPipelineEntryAllowed(ContentOrigin.ResidentLink, null)).toBe(false);
  });

  it('다른 origin은 이 게이트의 대상이 아니다 — 기존 파이프라인 무영향(회귀 0)', () => {
    expect(isPipelineEntryAllowed(ContentOrigin.ReporterUpload, null)).toBe(true);
    expect(isPipelineEntryAllowed(ContentOrigin.LiveVod, null)).toBe(true);
  });
});
