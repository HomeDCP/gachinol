import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request, Response } from 'express';
import request from 'supertest';
import { IS_PUBLIC_KEY } from '../common/decorators/public.decorator';
import { ROLES_KEY } from '../common/decorators/roles.decorator';
import { GoLinkController } from './go-link.controller';
import { GoLinkService, type GoLinkHttpResponse } from './go-link.service';

const CONTENT_ID = '01920000-0000-7000-8000-0000000000a1';

const makeRes = () => {
  const res = {
    setHeader: jest.fn(),
    status: jest.fn(),
    send: jest.fn(),
  };
  res.status.mockReturnValue(res);
  return res as unknown as Response & typeof res;
};

const makeReq = (over: Partial<Request> = {}): Request =>
  ({
    headers: {},
    protocol: 'http',
    path: `/v1/go/c/${CONTENT_ID}`,
    get: () => 'localhost:4000',
    ...over,
  }) as unknown as Request;

const okResponse: GoLinkHttpResponse = {
  status: 200,
  headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'public, max-age=300' },
  body: '<!doctype html>',
};

const makeController = () => {
  const service = {
    renderContentShare: jest.fn().mockResolvedValue(okResponse),
    resolveThumbnail: jest.fn().mockResolvedValue({
      status: 302,
      headers: { Location: 'https://s3.test/t.jpg' },
      body: '',
    } satisfies GoLinkHttpResponse),
  };
  return { controller: new GoLinkController(service as never), service };
};

describe('GoLinkController', () => {
  it('share — 서비스가 서술한 상태·헤더·본문을 그대로 기록한다', async () => {
    const { controller, service } = makeController();
    const res = makeRes();

    await controller.share(CONTENT_ID, makeReq(), res);

    expect(service.renderContentShare).toHaveBeenCalledWith(CONTENT_ID, {
      selfUrl: `http://localhost:4000/v1/go/c/${CONTENT_ID}`,
    });
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/html; charset=utf-8');
    expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'public, max-age=300');
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('<!doctype html>');
  });

  it('share — 프록시 헤더로 공개 오리진의 자기 URL을 만든다', async () => {
    const { controller, service } = makeController();

    await controller.share(
      CONTENT_ID,
      makeReq({
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'go.example.test' },
      }),
      makeRes(),
    );

    expect(service.renderContentShare).toHaveBeenCalledWith(CONTENT_ID, {
      selfUrl: `https://go.example.test/v1/go/c/${CONTENT_ID}`,
    });
  });

  it('thumbnail — 302와 Location을 그대로 전달한다', async () => {
    const { controller, service } = makeController();
    const res = makeRes();

    await controller.thumbnail(CONTENT_ID, res);

    expect(service.resolveThumbnail).toHaveBeenCalledWith(CONTENT_ID);
    expect(res.setHeader).toHaveBeenCalledWith('Location', 'https://s3.test/t.jpg');
    expect(res.status).toHaveBeenCalledWith(302);
  });

  it('두 라우트 모두 @Public — 카톡 익명 사용자·스크레이퍼가 최초 소비자다', () => {
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GoLinkController.prototype.share)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, GoLinkController.prototype.thumbnail)).toBe(true);
  });

  it('@Roles를 붙이지 않는다 (역할 게이트가 걸리면 공개 미리보기가 깨진다)', () => {
    expect(Reflect.getMetadata(ROLES_KEY, GoLinkController.prototype.share)).toBeUndefined();
    expect(Reflect.getMetadata(ROLES_KEY, GoLinkController)).toBeUndefined();
  });
});

/**
 * 실 HTTP 왕복 스모크 — 라우트 경로 해석과 `@Res()` 기록이 실제로 성립하는지.
 * 서비스는 스텁이라 DB·S3 불요. 전역 프리픽스(`v1`)는 `setup-app.ts`가 붙이므로 여기선
 * `/go/...`로 노출된다(운영 경로 = `/v1/go/c/:id`, 공개 경로 = `go.<도메인>/c/:id`).
 */
describe('GoLinkController (HTTP)', () => {
  let app: INestApplication;
  const service = {
    renderContentShare: jest.fn(),
    resolveThumbnail: jest.fn(),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [GoLinkController],
      providers: [{ provide: GoLinkService, useValue: service }],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /go/c/:id — 상태·헤더·HTML 본문이 그대로 나간다', async () => {
    service.renderContentShare.mockResolvedValue({
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=300, stale-if-error=604800',
      },
      body: '<!doctype html><html lang="ko"><head><meta property="og:title" content="제목">',
    } satisfies GoLinkHttpResponse);

    const res = await request(app.getHttpServer()).get(`/go/c/${CONTENT_ID}`).expect(200);

    expect(res.headers['content-type']).toContain('text/html');
    expect(res.headers['cache-control']).toContain('stale-if-error=604800');
    expect(res.text).toContain('og:title');
    expect(service.renderContentShare).toHaveBeenCalledWith(
      CONTENT_ID,
      expect.objectContaining({ selfUrl: expect.stringContaining(`/go/c/${CONTENT_ID}`) }),
    );
  });

  it('GET /go/c/:id/thumb — 별도 라우트로 해석되고 302 Location을 낸다', async () => {
    service.resolveThumbnail.mockResolvedValue({
      status: 302,
      headers: { Location: 'https://s3.test/t.jpg', 'Cache-Control': 'public, max-age=300' },
      body: '',
    } satisfies GoLinkHttpResponse);

    const res = await request(app.getHttpServer()).get(`/go/c/${CONTENT_ID}/thumb`).expect(302);

    expect(res.headers['location']).toBe('https://s3.test/t.jpg');
    // `/c/:id`가 `/c/:id/thumb`를 삼키지 않는다
    expect(service.renderContentShare).not.toHaveBeenCalledWith(
      `${CONTENT_ID}/thumb`,
      expect.anything(),
    );
  });

  it('없는 링크의 404 HTML도 그대로 전달한다', async () => {
    service.renderContentShare.mockResolvedValue({
      status: 404,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=60',
      },
      body: '<!doctype html><html lang="ko"><head><meta name="robots" content="noindex">',
    } satisfies GoLinkHttpResponse);

    const res = await request(app.getHttpServer()).get(`/go/c/${CONTENT_ID}`).expect(404);

    expect(res.text).toContain('noindex');
  });
});
