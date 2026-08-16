import { allContentTransitionEdges, ContentOrigin } from '@gachinol/shared';
import { DomainException } from '../common/errors/domain.exception';
import { assertResidentReviewApproved, isPipelineEntryEdge } from './resident-review.gate';
import { ResidentUploadStatus } from './resident-upload-status';

const reader = (status: string | null) => ({
  residentUpload: {
    findUnique: jest.fn().mockResolvedValue(status === null ? null : { status }),
  },
});

describe('isPipelineEntryEdge — "정식 파이프라인 진입"의 정의', () => {
  it('전이맵 전체에서 진입 엣지는 uploaded→processing 하나뿐이다', () => {
    const entries = allContentTransitionEdges().filter(([from, to]) => isPipelineEntryEdge(from, to));
    expect(entries).toEqual([['uploaded', 'processing']]);
  });

  it('processing 이후의 홉(processing→analyzing 등)은 진입 엣지가 아니다 — 게이트는 문턱에서 한 번만 묻는다', () => {
    expect(isPipelineEntryEdge('processing', 'analyzing')).toBe(false);
    expect(isPipelineEntryEdge('preview_generating', 'awaiting_center_review')).toBe(false);
    expect(isPipelineEntryEdge('uploading', 'uploaded')).toBe(false);
  });
});

describe('assertResidentReviewApproved — 조회+판정+예외의 유일 구현', () => {
  it.each([ContentOrigin.ReporterUpload, ContentOrigin.LiveVod])(
    "origin='%s'는 DB를 치지도 않고 통과한다 (기존 경로 무영향)",
    async (origin) => {
      const db = reader('awaiting_branch_review');
      await expect(assertResidentReviewApproved(db as never, { id: 'c-1', origin })).resolves
        .toBeUndefined();
      expect(db.residentUpload.findUnique).not.toHaveBeenCalled();
    },
  );

  it('승인된 주민 업로드만 통과한다', async () => {
    const db = reader(ResidentUploadStatus.Approved);
    await expect(
      assertResidentReviewApproved(db as never, { id: 'c-1', origin: ContentOrigin.ResidentLink }),
    ).resolves.toBeUndefined();
    expect(db.residentUpload.findUnique).toHaveBeenCalledWith({
      where: { contentId: 'c-1' },
      select: { status: true },
    });
  });

  it.each([
    ResidentUploadStatus.AwaitingBranchReview,
    ResidentUploadStatus.Rejected,
    ResidentUploadStatus.Pending,
    null, // 업로드 행 자체가 없는 유령 콘텐츠 — fail-closed
  ])('미승인(%s)은 invalid_transition + 사유 details', async (status) => {
    const db = reader(status);
    const err = await assertResidentReviewApproved(db as never, {
      id: 'c-1',
      origin: ContentOrigin.ResidentLink,
    }).then(
      () => null,
      (e) => e as DomainException,
    );

    expect(err).toBeInstanceOf(DomainException);
    expect(err?.code).toBe('invalid_transition');
    expect(err?.details).toEqual({ origin: 'resident_link', reviewStatus: status });
  });
});
