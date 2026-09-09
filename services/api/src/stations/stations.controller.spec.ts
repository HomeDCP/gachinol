import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@gachinol/shared';
import { RolesGuard } from '../auth/guards/roles.guard';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { DomainException } from '../common/errors/domain.exception';
import { adminUser, centerOperatorUser, reporterUser } from '../test-support/fixtures';
import { StationsController } from './stations.controller';
import type { StationWorkflowService } from './station-workflow.service';
import type { StationsService } from './stations.service';

/** subscriber 픽스처 — test-support/fixtures.ts에는 없어(대상 라우트가 없었으므로) 이 스펙 로컬로 둔다 */
const subscriberUser = (over: Partial<User> = {}): User =>
  ({
    id: 'u-subscriber',
    role: 'subscriber',
    name: '구독자',
    status: 'active',
    createdAt: '2026-07-20T00:00:00.000Z',
    updatedAt: '2026-07-20T00:00:00.000Z',
    ...over,
  }) as User;

const makeController = () => {
  const stations = {
    list: jest.fn().mockResolvedValue({ items: [], totalCount: 0, page: 1, pageSize: 20 }),
    get: jest.fn().mockResolvedValue({ id: 's-aewol' }),
  };
  const workflow = { transition: jest.fn() };
  return {
    controller: new StationsController(
      stations as unknown as StationsService,
      workflow as unknown as StationWorkflowService,
    ),
    stations,
  };
};

/**
 * 대장 #181 — GET /stations, GET /stations/:id에 @Roles가 없어 subscriber 토큰으로도
 * 관리용 지사 목록(supportTel·dormantSince·sortOrder)을 읽을 수 있었다.
 * 허용 역할은 실제 호출부 실측으로 정했다(추측 금지):
 *   - GET /stations       ← apps/control-center(features/stations/queries.ts)만 호출 → center_operator
 *   - GET /stations/:id   ← apps/reporter(features/contents/queries.ts) +
 *                           apps/control-center(features/stations/queries.ts) 양쪽 호출 → reporter, center_operator
 * (구독자 공개 목록은 별도 @Public 엔드포인트 GET /v1/feed/stations — apps/subscriber는 이쪽만 쓴다)
 */
describe('StationsController — 권한 게이트 (대장 #181)', () => {
  it('GET / — @Roles(center_operator), @Public 미부착', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StationsController.prototype.list)).toEqual([
      'center_operator',
    ]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, StationsController.prototype.list)).toBeUndefined();
  });

  it('GET /:id — @Roles(reporter, center_operator), @Public 미부착', () => {
    expect(Reflect.getMetadata(ROLES_KEY, StationsController.prototype.get)).toEqual([
      'reporter',
      'center_operator',
    ]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, StationsController.prototype.get)).toBeUndefined();
  });
});

/** RolesGuard를 실제로 구동해 subscriber가 403(forbidden)을 받는지 확인 — 메타데이터 존재만으로는
 * 값이 틀려도(예: 'subscriber' 오기입) 못 잡으므로 가드 동작까지 실행해 고정한다. */
describe('StationsController — RolesGuard 구동 (subscriber 차단 회귀)', () => {
  const guard = new RolesGuard(new Reflector());

  const mockContext = (handler: unknown, cls: unknown, user: User): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  it('list — subscriber는 forbidden(403 매핑)으로 거부된다', () => {
    expect(() =>
      guard.canActivate(
        mockContext(StationsController.prototype.list, StationsController, subscriberUser()),
      ),
    ).toThrow(DomainException);
    try {
      guard.canActivate(
        mockContext(StationsController.prototype.list, StationsController, subscriberUser()),
      );
    } catch (e) {
      expect((e as DomainException).code).toBe('forbidden');
    }
  });

  it('list — center_operator는 통과한다', () => {
    expect(
      guard.canActivate(
        mockContext(
          StationsController.prototype.list,
          StationsController,
          centerOperatorUser(),
        ),
      ),
    ).toBe(true);
  });

  it('list — admin은 수퍼롤로 통과한다(명시 목록에 없어도)', () => {
    expect(
      guard.canActivate(
        mockContext(StationsController.prototype.list, StationsController, adminUser()),
      ),
    ).toBe(true);
  });

  it('get(:id) — subscriber는 forbidden으로 거부된다', () => {
    expect(() =>
      guard.canActivate(
        mockContext(StationsController.prototype.get, StationsController, subscriberUser()),
      ),
    ).toThrow(DomainException);
  });

  it('get(:id) — reporter는 통과한다(기자 앱이 소속 지사명 표시에 사용)', () => {
    expect(
      guard.canActivate(
        mockContext(StationsController.prototype.get, StationsController, reporterUser()),
      ),
    ).toBe(true);
  });

  it('get(:id) — center_operator는 통과한다', () => {
    expect(
      guard.canActivate(
        mockContext(StationsController.prototype.get, StationsController, centerOperatorUser()),
      ),
    ).toBe(true);
  });
});

describe('StationsController (조립점)', () => {
  it('list·get은 서비스에 그대로 위임한다', async () => {
    const { controller, stations } = makeController();

    await controller.list({} as never);
    await controller.get('s-aewol');

    expect(stations.list).toHaveBeenCalledWith({});
    expect(stations.get).toHaveBeenCalledWith('s-aewol');
  });
});
