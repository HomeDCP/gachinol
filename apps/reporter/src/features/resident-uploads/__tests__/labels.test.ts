import { ResidentUploadStatus } from '@gachinol/shared';
import { RESIDENT_UPLOAD_STATUS_BADGE, residentUploadStatusBadge } from '../labels';

describe('RESIDENT_UPLOAD_STATUS_BADGE — 5종 전수', () => {
  const all = Object.values(ResidentUploadStatus);

  test('상태 5종', () => {
    expect(all).toHaveLength(5);
  });

  test.each(all)('%s — 라벨·톤 존재·비어있지 않음', (status) => {
    const badge = residentUploadStatusBadge(status);
    expect(badge.label.length).toBeGreaterThan(0);
    expect(badge.tone.length).toBeGreaterThan(0);
  });

  test('검수 대기는 warning 톤 — 검수자 확인이 필요한 상태를 눈에 띄게', () => {
    expect(RESIDENT_UPLOAD_STATUS_BADGE.awaiting_branch_review.tone).toBe('warning');
  });

  test('반려·업로드실패는 danger 톤', () => {
    expect(RESIDENT_UPLOAD_STATUS_BADGE.rejected.tone).toBe('danger');
    expect(RESIDENT_UPLOAD_STATUS_BADGE.upload_failed.tone).toBe('danger');
  });

  test('승인됨은 success 톤', () => {
    expect(RESIDENT_UPLOAD_STATUS_BADGE.approved.tone).toBe('success');
  });
});
