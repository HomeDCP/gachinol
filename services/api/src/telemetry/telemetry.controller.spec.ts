import { HttpException, HttpStatus, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
// 배치·payload 상한은 shared가 단일 원천(T-W2-29) — 클라이언트가 지켜야 하는 값이라 승격됐다
import { TELEMETRY_MAX_BATCH_SIZE, TELEMETRY_MAX_PAYLOAD_BYTES } from '@gachinol/shared';
import { TelemetryService } from './telemetry.service';
import { TELEMETRY_RATE_LIMIT_CAPACITY } from './telemetry-rate-limiter';
import { TelemetryController } from './telemetry.controller';

const makeController = () => {
  const service = {
    ingest: jest.fn().mockReturnValue({ accepted: 0, unknownEventCount: 0 }),
    summary: jest.fn(),
  };
  return { controller: new TelemetryController(service as never), service };
};

/** 실 Express Request 대신 extractClientIp가 필요로 하는 최소 형태만 갖춘 스텁 */
const fakeReq = (ip = '127.0.0.1'): Request =>
  ({ headers: { 'x-forwarded-for': ip }, socket: { remoteAddress: ip } }) as unknown as Request;

describe('TelemetryController — 권한 게이트(메타데이터, AC: 권한 게이트)', () => {
  it('POST events — @Public(익명 허용, 구독자 웹은 로그인 개념이 없다)', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, TelemetryController.prototype.ingest)).toBe(true);
  });

  it('GET summary — @Roles(center_operator, admin) 전용, @Public 미부착', () => {
    expect(Reflect.getMetadata(ROLES_KEY, TelemetryController.prototype.summary)).toEqual([
      'center_operator',
      'admin',
    ]);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, TelemetryController.prototype.summary)).toBeUndefined();
  });
});

describe('TelemetryController (조립점)', () => {
  it('ingest — 서비스에 배열을 그대로 위임하고 결과를 그대로 반환한다', () => {
    const { controller, service } = makeController();
    service.ingest.mockReturnValue({ accepted: 2, unknownEventCount: 1 });
    const events = [{ name: 'playback_start' }, { name: 'mode_selected' }, { name: 'x' }];

    const result = controller.ingest(events as never, fakeReq());

    expect(service.ingest).toHaveBeenCalledWith(events);
    expect(result).toEqual({ accepted: 2, unknownEventCount: 1 });
  });

  it('summary — 서비스 결과를 그대로 반환한다', () => {
    const { controller, service } = makeController();
    const summary = { totalEventsReceived: 5 };
    service.summary.mockReturnValue(summary);

    expect(controller.summary()).toBe(summary);
  });
});

describe('TelemetryController — IP 레이트리밋(대장 #79 조치④, AC: 레이트 초과 → 429)', () => {
  it(`같은 IP에서 capacity(${TELEMETRY_RATE_LIMIT_CAPACITY}건) 초과 요청은 429(HttpException)를 던진다`, () => {
    const { controller } = makeController();
    const events = [{ name: 'playback_start' }] as never;
    const req = fakeReq('203.0.113.10');

    for (let i = 0; i < TELEMETRY_RATE_LIMIT_CAPACITY; i += 1) {
      expect(() => controller.ingest(events, req)).not.toThrow();
    }

    let caught: unknown;
    try {
      controller.ingest(events, req);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(HttpException);
    expect((caught as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
  });

  it('X-Forwarded-For가 다르면 독립 버킷 — 한 IP의 소진이 다른 IP를 막지 않는다', () => {
    const { controller } = makeController();
    const events = [{ name: 'playback_start' }] as never;
    const reqA = fakeReq('198.51.100.1');
    const reqB = fakeReq('198.51.100.2');

    for (let i = 0; i < TELEMETRY_RATE_LIMIT_CAPACITY; i += 1) controller.ingest(events, reqA);
    expect(() => controller.ingest(events, reqA)).toThrow(HttpException);
    // reqB는 별도 IP라 여전히 통과 — 동시에 이것이 X-Forwarded-For 신뢰의 한계이기도 하다:
    // 공격자가 매 요청 X-Forwarded-For 값을 바꾸면 이 "독립 버킷" 특성 자체가 우회 수단이 된다
    // (레지스트리 상한(maxKeys)이 그 우회의 무한 확장만 막아준다 — telemetry-rate-limiter.ts 참고).
    expect(() => controller.ingest(events, reqB)).not.toThrow();
  });
});

/**
 * 실 HTTP 왕복 — 전역 ZodValidationPipe·AllExceptionsFilter를 실제로 붙여
 * 배치 상한·봉투 검증이 요청 경계에서 실제로 작동하는지 확인한다(AC: 배치 크기 상한).
 * 서비스는 스텁이라 DB 불요.
 */
describe('TelemetryController (HTTP)', () => {
  let app: INestApplication;
  const service = {
    ingest: jest.fn(),
    summary: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [{ provide: TelemetryService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    service.ingest.mockReset().mockReturnValue({ accepted: 1, unknownEventCount: 0 });
    service.summary.mockReset();
  });

  it('POST /telemetry/events — 유효 배치는 200 + 서비스 위임', async () => {
    const res = await request(app.getHttpServer())
      .post('/telemetry/events')
      .send([{ name: 'playback_start', contentId: 'c-1' }])
      .expect(200);

    expect(res.body).toEqual({ accepted: 1, unknownEventCount: 0 });
    expect(service.ingest).toHaveBeenCalledWith([{ name: 'playback_start', contentId: 'c-1' }]);
  });

  it('POST /telemetry/events — 카탈로그 밖 이벤트 이름도 구조만 맞으면 200(배치 거부 아님)', async () => {
    await request(app.getHttpServer())
      .post('/telemetry/events')
      .send([{ name: 'a_totally_unknown_event' }])
      .expect(200);

    expect(service.ingest).toHaveBeenCalledWith([{ name: 'a_totally_unknown_event' }]);
  });

  it('POST /telemetry/events — 빈 배열은 400(validation_failed)', async () => {
    const res = await request(app.getHttpServer()).post('/telemetry/events').send([]).expect(400);

    expect(res.body.code).toBe('validation_failed');
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('POST /telemetry/events — name 누락 이벤트가 섞이면 배치 전체 400(봉투 구조 위반)', async () => {
    const res = await request(app.getHttpServer())
      .post('/telemetry/events')
      .send([{ name: 'playback_start' }, { sessionId: 'no-name-here' }])
      .expect(400);

    expect(res.body.code).toBe('validation_failed');
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it(`POST /telemetry/events — 배치 상한(${TELEMETRY_MAX_BATCH_SIZE}건) 초과는 400`, async () => {
    const oversized = Array.from({ length: TELEMETRY_MAX_BATCH_SIZE + 1 }, () => ({
      name: 'playback_start',
    }));

    const res = await request(app.getHttpServer())
      .post('/telemetry/events')
      .send(oversized)
      .expect(400);

    expect(res.body.code).toBe('validation_failed');
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it(`POST /telemetry/events — 배치 상한(${TELEMETRY_MAX_BATCH_SIZE}건) 이하는 200`, async () => {
    const atLimit = Array.from({ length: TELEMETRY_MAX_BATCH_SIZE }, () => ({
      name: 'playback_start',
    }));

    await request(app.getHttpServer()).post('/telemetry/events').send(atLimit).expect(200);

    expect(service.ingest).toHaveBeenCalled();
  });

  it(`POST /telemetry/events — 개별 이벤트 payload가 상한(${TELEMETRY_MAX_PAYLOAD_BYTES}바이트) 초과면 400(AC: 과대 payload)`, async () => {
    const res = await request(app.getHttpServer())
      .post('/telemetry/events')
      .send([{ name: 'playback_start', payload: { big: 'x'.repeat(TELEMETRY_MAX_PAYLOAD_BYTES + 1) } }])
      .expect(400);

    expect(res.body.code).toBe('validation_failed');
    expect(service.ingest).not.toHaveBeenCalled();
  });

  it('GET /telemetry/summary — 서비스 롤업을 그대로 반환한다', async () => {
    service.summary.mockReturnValue({ totalEventsReceived: 7, unknownEventCount: 0 });

    const res = await request(app.getHttpServer()).get('/telemetry/summary').expect(200);

    expect(res.body).toEqual({ totalEventsReceived: 7, unknownEventCount: 0 });
  });
});

/**
 * 별도 app 인스턴스(=별도 TelemetryController=별도 레이트리미터 상태) — 위 공유 describe 블록의
 * 성공 요청 예산(약 3건)을 건드리지 않기 위해 격리한다. 실 HTTP 왕복으로 AllExceptionsFilter를
 * 경유해 429가 실제 응답 상태 코드로 나가는지까지 실측한다(AC: 레이트 초과 → 429).
 */
describe('TelemetryController (HTTP) — IP 레이트리밋 429 실측', () => {
  let app: INestApplication;
  const service = {
    ingest: jest.fn().mockReturnValue({ accepted: 1, unknownEventCount: 0 }),
    summary: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TelemetryController],
      providers: [{ provide: TelemetryService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ZodValidationPipe());
    app.useGlobalFilters(new AllExceptionsFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it(
    `같은 소스에서 capacity(${TELEMETRY_RATE_LIMIT_CAPACITY}건)까지는 200, 그다음 요청은 실제 HTTP 429`,
    async () => {
      for (let i = 0; i < TELEMETRY_RATE_LIMIT_CAPACITY; i += 1) {
        await request(app.getHttpServer())
          .post('/telemetry/events')
          .send([{ name: 'playback_start' }])
          .expect(200);
      }

      await request(app.getHttpServer())
        .post('/telemetry/events')
        .send([{ name: 'playback_start' }])
        .expect(429);
    },
    15_000,
  );
});
