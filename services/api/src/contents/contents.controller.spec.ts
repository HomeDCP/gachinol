import { centerOperatorUser, contentRow, reporterUser } from '../test-support/fixtures';
import { ContentsController } from './contents.controller';

/** 최소 조립점 검증(위 setup과 별도) — 컨텍이터→서비스 위임만 확인, 비즈니스 로직은 contents.service.spec.ts 소관 */
const setupMinorConsent = () => {
  const contents = {
    confirmMinorConsent: jest.fn(),
    withdrawMinorConsent: jest.fn(),
  };
  const controller = new ContentsController(
    contents as never, // contents
    {} as never, // workflow
    {} as never, // producer
    {} as never, // analysisProducer
    {} as never, // distributionProducer
    {} as never, // distribution
  );
  return { contents, controller };
};

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

describe('ContentsController — 미성년자 동의 확인/철회 위임(T-W2-23)', () => {
  it('POST :id/minor-consent → contents.confirmMinorConsent(user, id)로 위임', async () => {
    const { contents, controller } = setupMinorConsent();
    const confirmed = contentRow({
      hasMinorSubject: true,
      minorConsentConfirmedByUserId: 'u-center',
    });
    contents.confirmMinorConsent.mockResolvedValue(confirmed);
    const user = centerOperatorUser();

    const res = await controller.confirmMinorConsent(user, 'c-1');

    expect(contents.confirmMinorConsent).toHaveBeenCalledWith(user, 'c-1');
    expect(res).toBe(confirmed);
  });

  it('DELETE :id/minor-consent → contents.withdrawMinorConsent(user, id)로 위임', async () => {
    const { contents, controller } = setupMinorConsent();
    const withdrawn = contentRow({ hasMinorSubject: true });
    contents.withdrawMinorConsent.mockResolvedValue(withdrawn);
    const user = centerOperatorUser();

    const res = await controller.withdrawMinorConsent(user, 'c-1');

    expect(contents.withdrawMinorConsent).toHaveBeenCalledWith(user, 'c-1');
    expect(res).toBe(withdrawn);
  });
});

describe('ContentsController — 사후 자막 보강 위임 (T-W2-34, 대장 #123)', () => {
  const setupCaptions = () => {
    const contents = { updateCaptions: jest.fn() };
    const controller = new ContentsController(
      contents as never, // contents
      {} as never, // workflow
      {} as never, // producer
      {} as never, // analysisProducer
      {} as never, // distributionProducer
      {} as never, // distribution
    );
    return { contents, controller };
  };

  it('PATCH :id/captions → contents.updateCaptions(user, id, body)로 위임 (바디 그대로)', async () => {
    const { contents, controller } = setupCaptions();
    contents.updateCaptions.mockResolvedValue(contentRow({ status: 'uploaded' }));
    const user = reporterUser();
    const body = { scenes: [{ order: 0, caption: '자막', startSec: null, endSec: null }] };

    const res = await controller.updateCaptions(user, 'c-1', body as never);

    expect(contents.updateCaptions).toHaveBeenCalledWith(user, 'c-1', body);
    expect(res.status).toBe('uploaded');
  });
});
