import { HttpException, HttpStatus } from '@nestjs/common';
import type { Request } from 'express';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { reporterUser } from '../test-support/fixtures';
import { ResidentLinksController } from './resident-links.controller';
import { RESIDENT_UPLOAD_RATE_LIMIT_CAPACITY } from './resident-links.constants';

const TOKEN = 'a'.repeat(43);

const makeController = () => {
  const service = {
    issue: jest.fn().mockResolvedValue({ token: 't' }),
    describe: jest.fn().mockResolvedValue({ valid: true }),
    createUpload: jest.fn().mockResolvedValue({ uploadId: 'ru-1' }),
    completeUpload: jest.fn().mockResolvedValue({ status: 'awaiting_branch_review' }),
  };
  return { controller: new ResidentLinksController(service as never), service };
};

/** extractClientIp가 필요로 하는 최소 형태만 갖춘 스텁(telemetry.controller.spec 선례) */
const fakeReq = (ip = '203.0.113.7'): Request =>
  ({ headers: { 'cf-connecting-ip': ip }, socket: { remoteAddress: ip } }) as unknown as Request;

describe('ResidentLinksController — 권한 게이트 (AC2)', () => {
  it('POST / — 지사 담당자 인증 필요(@Roles reporter·admin), @Public 미부착', () => {
    expect(Reflect.getMetadata(ROLES_KEY, ResidentLinksController.prototype.issue)).toEqual([
      'reporter',
      'admin',
    ]);
    expect(
      Reflect.getMetadata(IS_PUBLIC_KEY, ResidentLinksController.prototype.issue),
    ).toBeUndefined();
  });

  it('무인증 3종은 전부 @Public — 주민은 로그인 개념이 없다(03 §C-5)', () => {
    for (const handler of [
      ResidentLinksController.prototype.describe,
      ResidentLinksController.prototype.createUpload,
      ResidentLinksController.prototype.complete,
    ]) {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).toBe(true);
      expect(Reflect.getMetadata(ROLES_KEY, handler)).toBeUndefined();
    }
  });
});

describe('ResidentLinksController (조립점)', () => {
  it('각 라우트는 서비스에 그대로 위임한다', async () => {
    const { controller, service } = makeController();
    const user = reporterUser();

    await controller.issue(user, { stationId: undefined } as never);
    await controller.describe(TOKEN);
    await controller.createUpload(TOKEN, { fileName: 'a.mp4' } as never, fakeReq());
    await controller.complete(TOKEN, 'ru-1');

    expect(service.issue).toHaveBeenCalledWith(user, { stationId: undefined });
    expect(service.describe).toHaveBeenCalledWith(TOKEN);
    expect(service.createUpload).toHaveBeenCalledWith(TOKEN, { fileName: 'a.mp4' });
    expect(service.completeUpload).toHaveBeenCalledWith(TOKEN, 'ru-1');
  });
});

describe('ResidentLinksController — IP 레이트리밋 (AC3: 동일 IP 시간당 10회 초과 차단)', () => {
  it('10회까지 통과, 11회째부터 429', async () => {
    const { controller, service } = makeController();
    const req = fakeReq('203.0.113.10');

    for (let i = 0; i < RESIDENT_UPLOAD_RATE_LIMIT_CAPACITY; i += 1) {
      await controller.createUpload(TOKEN, {} as never, req);
    }
    expect(service.createUpload).toHaveBeenCalledTimes(10);

    try {
      await controller.createUpload(TOKEN, {} as never, req);
      throw new Error('429가 발생해야 한다');
    } catch (e) {
      expect(e).toBeInstanceOf(HttpException);
      expect((e as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    }
    expect(service.createUpload).toHaveBeenCalledTimes(10); // 초과분은 서비스에 닿지 않는다
  });

  it('버킷은 IP별 — 한 IP가 소진해도 다른 IP는 영향 없다', async () => {
    const { controller, service } = makeController();
    for (let i = 0; i < RESIDENT_UPLOAD_RATE_LIMIT_CAPACITY; i += 1) {
      await controller.createUpload(TOKEN, {} as never, fakeReq('198.51.100.1'));
    }
    await expect(
      controller.createUpload(TOKEN, {} as never, fakeReq('198.51.100.2')),
    ).resolves.toBeDefined();
    expect(service.createUpload).toHaveBeenCalledTimes(11);
  });

  it('완료 통지는 이 버킷을 쓰지 않는다 — 정직한 사용자가 예산을 두 번 내지 않는다(의도된 설계)', async () => {
    const { controller, service } = makeController();
    const req = fakeReq('198.51.100.9');
    for (let i = 0; i < RESIDENT_UPLOAD_RATE_LIMIT_CAPACITY; i += 1) {
      await controller.createUpload(TOKEN, {} as never, req);
    }
    for (let i = 0; i < 5; i += 1) await controller.complete(TOKEN, `ru-${i}`);
    expect(service.completeUpload).toHaveBeenCalledTimes(5);
  });
});
