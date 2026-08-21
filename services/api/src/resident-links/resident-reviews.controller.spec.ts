import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { reporterUser } from '../test-support/fixtures';
import { ResidentLinksController } from './resident-links.controller';
import { ResidentReviewsController } from './resident-reviews.controller';

const makeController = () => {
  const service = {
    listQueue: jest.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, totalCount: 0 }),
    findOne: jest.fn().mockResolvedValue({ id: 'ru-1', status: 'awaiting_branch_review' }),
    approve: jest.fn().mockResolvedValue({ status: 'approved' }),
    reject: jest.fn().mockResolvedValue({ status: 'rejected' }),
  };
  return { controller: new ResidentReviewsController(service as never), service };
};

describe('ResidentReviewsController — 권한 게이트 (AC2·AC7)', () => {
  const handlers = [
    ResidentReviewsController.prototype.list,
    // 단건 조회(대장 #120)도 같은 게이트를 받는다 — 이 배열에 넣는 것이 요점이다.
    // 새 라우트를 추가하고 여기 넣지 않으면 권한 검증이 조용히 그 라우트를 비껴간다.
    ResidentReviewsController.prototype.findOne,
    ResidentReviewsController.prototype.approve,
    ResidentReviewsController.prototype.reject,
  ];

  it('★ 검수 4종 전부 인증 필요 — @Public 미부착(무인증 표면에 PII 노출 금지, 07 §3-15)', () => {
    for (const handler of handlers) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
    }
  });

  it('★ 권한은 발급 엔드포인트(T-W2-08)와 정합한다 — 발급한 사람이 검수한다', () => {
    const issueRoles = Reflect.getMetadata(ROLES_KEY, ResidentLinksController.prototype.issue);
    expect(issueRoles).toEqual(['reporter', 'admin']);
    for (const handler of handlers) {
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(issueRoles);
    }
  });
});

describe('ResidentReviewsController (조립점)', () => {
  it('각 라우트는 서비스에 그대로 위임한다', async () => {
    const { controller, service } = makeController();
    const user = reporterUser();
    const query = { page: 1, pageSize: 20 } as never;

    await controller.list(user, query);
    await controller.findOne(user, 'ru-1');
    await controller.approve(user, 'ru-1');
    await controller.reject(user, 'ru-1');

    expect(service.listQueue).toHaveBeenCalledWith(user, query);
    expect(service.findOne).toHaveBeenCalledWith(user, 'ru-1');
    expect(service.approve).toHaveBeenCalledWith(user, 'ru-1');
    expect(service.reject).toHaveBeenCalledWith(user, 'ru-1');
  });
});
