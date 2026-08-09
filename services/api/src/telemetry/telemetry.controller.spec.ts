import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ZodValidationPipe } from 'nestjs-zod';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { AllExceptionsFilter } from '../common/filters/all-exceptions.filter';
import { TELEMETRY_MAX_BATCH_SIZE, TelemetryService } from './telemetry.service';
import { TelemetryController } from './telemetry.controller';

const makeController = () => {
  const service = {
    ingest: jest.fn().mockReturnValue({ accepted: 0, unknownEventCount: 0 }),
    summary: jest.fn(),
  };
  return { controller: new TelemetryController(service as never), service };
};

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

    const result = controller.ingest(events as never);

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

  it('GET /telemetry/summary — 서비스 롤업을 그대로 반환한다', async () => {
    service.summary.mockReturnValue({ totalEventsReceived: 7, unknownEventCount: 0 });

    const res = await request(app.getHttpServer()).get('/telemetry/summary').expect(200);

    expect(res.body).toEqual({ totalEventsReceived: 7, unknownEventCount: 0 });
  });
});
