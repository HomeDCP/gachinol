import { centerOperatorUser, contentRow, reporterUser } from '../test-support/fixtures';
import { ContentsController } from './contents.controller';

/**
 * 컨트롤러 조립점 검증 — approve 후 reporter_only 자동 연쇄(status=publishing)일 때만 자동 송출 트리거.
 * center 승인 경로(center_approved)는 미트리거(이중 송출 없음). 자동 송출 실패는 승인 응답을 깨지 않는다(에러 격리).
 */
const setup = () => {
  const workflow = { approve: jest.fn() };
  const distribution = { startAutoDistribution: jest.fn().mockResolvedValue([]) };
  const controller = new ContentsController(
    {} as never, // contents
    workflow as never, // workflow
    {} as never, // producer
    {} as never, // analysisProducer
    {} as never, // distributionProducer
    distribution as never, // distribution
  );
  // 에러 격리 테스트에서 logger.error 노이즈 억제
  jest
    .spyOn((controller as unknown as { logger: { error: () => void } }).logger, 'error')
    .mockImplementation(() => undefined);
  return { workflow, distribution, controller };
};

describe('ContentsController.approve — 자동 송출 조립점', () => {
  it('reporter_only 자동 연쇄(status=publishing) → startAutoDistribution(updated, user) 트리거', async () => {
    const { workflow, distribution, controller } = setup();
    const publishing = contentRow({ status: 'publishing' });
    workflow.approve.mockResolvedValue(publishing);
    const user = reporterUser();

    const res = await controller.approve(user, 'c-1');

    expect(res.status).toBe('publishing');
    expect(distribution.startAutoDistribution).toHaveBeenCalledWith(publishing, user);
  });

  it('센터 승인(status=center_approved) → 자동 송출 미트리거(이중 송출 없음)', async () => {
    const { workflow, distribution, controller } = setup();
    workflow.approve.mockResolvedValue(contentRow({ status: 'center_approved' }));

    const res = await controller.approve(centerOperatorUser(), 'c-1');

    expect(res.status).toBe('center_approved');
    expect(distribution.startAutoDistribution).not.toHaveBeenCalled();
  });

  it('기자 승인이지만 reporter_then_center(status=awaiting_center_review) → 미트리거', async () => {
    const { workflow, distribution, controller } = setup();
    workflow.approve.mockResolvedValue(contentRow({ status: 'awaiting_center_review' }));

    await controller.approve(reporterUser(), 'c-1');

    expect(distribution.startAutoDistribution).not.toHaveBeenCalled();
  });

  it('자동 송출 실패 → 승인 응답 유지(에러 격리, throw 없음)', async () => {
    const { workflow, distribution, controller } = setup();
    workflow.approve.mockResolvedValue(contentRow({ status: 'publishing' }));
    distribution.startAutoDistribution.mockRejectedValue(new Error('큐 다운'));

    const res = await controller.approve(reporterUser(), 'c-1');

    expect(res.status).toBe('publishing'); // 200 응답 유지(승인 자체는 커밋됨)
  });
});
