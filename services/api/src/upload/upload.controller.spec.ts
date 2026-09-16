import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@gachinol/shared';
import { RolesGuard } from '../auth/guards/roles.guard';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { DomainException } from '../common/errors/domain.exception';
import { adminUser, centerOperatorUser, reporterUser } from '../test-support/fixtures';
import { UploadController } from './upload.controller';
import type { UploadService } from './upload.service';

/** subscriber 픽스처 — test-support/fixtures.ts에는 없음(대상 라우트가 없었으므로) 이 스펙 로컬로 둔다 */
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

/**
 * 대장 #216 보완1 — `UploadController`의 5개 라우트가 전부 `@Roles('reporter')`뿐이라
 * `ContentWorkflowService`의 `requireOwnerOrCenter` 완화(admin·center_operator 허용)가 무색했다:
 * center_operator는 `RolesGuard`에서 403을 맞아 서비스에 도달조차 못 했다(수혜자는 admin 수퍼롤 하나뿐).
 * `cancel()`(`contents.controller.ts:201` — `@Roles('reporter', 'center_operator')`)과 짝을 맞춘다.
 *
 * `controller-role-gate.mjs`는 "가드가 있는지"만 보고 "역할 목록이 서비스 술어와 정합한지"는 보지
 * 않는다(verifier 지적) — 그래서 메타데이터 값 자체를 여기서 단언한다(StationsController.spec.ts,
 * 대장 #181 선례 패턴).
 */
describe('UploadController — 권한 게이트 (대장 #216 보완1)', () => {
  const routes: Array<[string, () => object]> = [
    ['issueUploadUrl (POST :id/upload-url)', () => UploadController.prototype.issueUploadUrl],
    ['completeUpload (POST :id/upload-complete)', () => UploadController.prototype.completeUpload],
    [
      'startMultipartUpload (POST :id/multipart-upload)',
      () => UploadController.prototype.startMultipartUpload,
    ],
    [
      'completeMultipartUpload (POST :id/multipart-upload-complete)',
      () => UploadController.prototype.completeMultipartUpload,
    ],
    [
      'abortMultipartUpload (POST :id/multipart-upload-abort)',
      () => UploadController.prototype.abortMultipartUpload,
    ],
    [
      'recoverStalledUpload (POST :id/upload-recover, 대장 #224)',
      () => UploadController.prototype.recoverStalledUpload,
    ],
  ];

  it.each(routes)('%s — @Roles(reporter, center_operator), @Public 미부착', (_label, getHandler) => {
    const handler = getHandler();
    expect(Reflect.getMetadata(ROLES_KEY, handler)).toEqual(['reporter', 'center_operator']);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBeUndefined();
  });
});

/** RolesGuard를 실제로 구동해 reporter·center_operator는 통과, subscriber는 차단, admin은 수퍼롤로
 * 통과하는지 확인한다 — 메타데이터 존재·값만으로는 가드 동작 자체가 깨진 경우(예: 리플렉터 결선 오류)를
 * 못 잡으므로 실행까지 고정한다. */
describe('UploadController — RolesGuard 구동 (reporter·center_operator 통과, subscriber 차단)', () => {
  const guard = new RolesGuard(new Reflector());

  const mockContext = (handler: unknown, cls: unknown, user: User): ExecutionContext =>
    ({
      getHandler: () => handler,
      getClass: () => cls,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const routes: Array<[string, () => object]> = [
    ['upload-url', () => UploadController.prototype.issueUploadUrl],
    ['upload-complete', () => UploadController.prototype.completeUpload],
    ['multipart-upload', () => UploadController.prototype.startMultipartUpload],
    ['multipart-upload-complete', () => UploadController.prototype.completeMultipartUpload],
    ['multipart-upload-abort', () => UploadController.prototype.abortMultipartUpload],
    ['upload-recover (대장 #224)', () => UploadController.prototype.recoverStalledUpload],
  ];

  it.each(routes)('%s — reporter는 통과한다', (_label, getHandler) => {
    expect(
      guard.canActivate(
        mockContext(getHandler(), UploadController, reporterUser()),
      ),
    ).toBe(true);
  });

  it.each(routes)('%s — center_operator는 통과한다(보완1)', (_label, getHandler) => {
    expect(
      guard.canActivate(
        mockContext(getHandler(), UploadController, centerOperatorUser()),
      ),
    ).toBe(true);
  });

  it.each(routes)('%s — admin은 수퍼롤로 통과한다(명시 목록에 없어도)', (_label, getHandler) => {
    expect(
      guard.canActivate(mockContext(getHandler(), UploadController, adminUser())),
    ).toBe(true);
  });

  it.each(routes)('%s — subscriber는 forbidden으로 거부된다', (_label, getHandler) => {
    expect(() =>
      guard.canActivate(mockContext(getHandler(), UploadController, subscriberUser())),
    ).toThrow(DomainException);
    try {
      guard.canActivate(mockContext(getHandler(), UploadController, subscriberUser()));
    } catch (e) {
      expect((e as DomainException).code).toBe('forbidden');
    }
  });
});

describe('UploadController (조립점) — 서비스에 그대로 위임', () => {
  const makeController = () => {
    const upload = {
      issueUploadUrl: jest.fn().mockResolvedValue({ storageKey: 'k', uploadUrl: 'u', expiresAt: 'e' }),
      completeUpload: jest.fn().mockResolvedValue({ id: 'c-1' }),
      startMultipartUpload: jest
        .fn()
        .mockResolvedValue({ storageKey: 'k', uploadId: 'up-1', partSizeBytes: 1, parts: [], expiresAt: 'e' }),
      completeMultipartUpload: jest.fn().mockResolvedValue({ id: 'c-1' }),
      abortMultipartUpload: jest.fn().mockResolvedValue({ id: 'c-1' }),
      recoverStalledUpload: jest.fn().mockResolvedValue({ id: 'c-1' }),
    };
    return { controller: new UploadController(upload as unknown as UploadService), upload };
  };

  it('각 핸들러가 인자 그대로 서비스에 위임한다', async () => {
    const { controller, upload } = makeController();
    const user = reporterUser();

    await controller.issueUploadUrl(user, 'c-1', { contentId: 'c-1' } as never);
    expect(upload.issueUploadUrl).toHaveBeenCalledWith(user, 'c-1', { contentId: 'c-1' });

    await controller.completeUpload(user, 'c-1', { contentId: 'c-1' } as never);
    expect(upload.completeUpload).toHaveBeenCalledWith(user, 'c-1', { contentId: 'c-1' });

    await controller.startMultipartUpload(user, 'c-1', { contentId: 'c-1' } as never);
    expect(upload.startMultipartUpload).toHaveBeenCalledWith(user, 'c-1', { contentId: 'c-1' });

    await controller.completeMultipartUpload(user, 'c-1', { contentId: 'c-1' } as never);
    expect(upload.completeMultipartUpload).toHaveBeenCalledWith(user, 'c-1', { contentId: 'c-1' });

    await controller.abortMultipartUpload(user, 'c-1', { contentId: 'c-1' } as never);
    expect(upload.abortMultipartUpload).toHaveBeenCalledWith(user, 'c-1', { contentId: 'c-1' });

    await controller.recoverStalledUpload(user, 'c-1');
    expect(upload.recoverStalledUpload).toHaveBeenCalledWith(user, 'c-1');
  });
});
