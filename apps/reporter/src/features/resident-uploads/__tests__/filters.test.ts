import { ResidentUploadStatus } from '@gachinol/shared';
import { RESIDENT_UPLOAD_FILTERS, residentUploadFilterFromIndex } from '../filters';

describe('RESIDENT_UPLOAD_FILTERS', () => {
  test('3종 — 대기·승인·반려. 전체 필터는 없다(서버가 상태 전체 조회를 지원하지 않는다)', () => {
    expect(RESIDENT_UPLOAD_FILTERS).toHaveLength(3);
    expect(RESIDENT_UPLOAD_FILTERS.map((f) => f.status)).toEqual([
      ResidentUploadStatus.AwaitingBranchReview,
      ResidentUploadStatus.Approved,
      ResidentUploadStatus.Rejected,
    ]);
  });
});

describe('residentUploadFilterFromIndex', () => {
  test('index 0 — 검수 대기(기본)', () => {
    expect(residentUploadFilterFromIndex(0)).toEqual({
      status: ResidentUploadStatus.AwaitingBranchReview,
    });
  });

  test('index 1·2 — 승인·반려', () => {
    expect(residentUploadFilterFromIndex(1)).toEqual({ status: ResidentUploadStatus.Approved });
    expect(residentUploadFilterFromIndex(2)).toEqual({ status: ResidentUploadStatus.Rejected });
  });

  test('범위 밖 index는 기본(검수 대기)으로 수렴', () => {
    expect(residentUploadFilterFromIndex(99)).toEqual({
      status: ResidentUploadStatus.AwaitingBranchReview,
    });
    expect(residentUploadFilterFromIndex(-1)).toEqual({
      status: ResidentUploadStatus.AwaitingBranchReview,
    });
  });
});
