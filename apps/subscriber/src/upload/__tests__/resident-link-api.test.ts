import { ApiClientError, ApiNetworkError } from '../../api/errors';
import {
  completeResidentUpload,
  createResidentUpload,
  describeResidentLink,
} from '../resident-link-api';

/**
 * 무인증 HTTP 표면 고정 — T-W2-09.
 * 서버(T-W2-08) 경로·바디 계약과, 토큰이 요청 밖으로 새지 않는다는 점을 고정한다.
 */

const TOKEN = 'kZ8m_test-token-0000000000000000000000000000';
const deps = (fetchFn: typeof fetch) => ({ baseUrl: 'https://example.test', fetchFn });

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('describeResidentLink', () => {
  it('GET /v1/resident-links/:token — 토큰은 경로에만, 쿼리·헤더·바디에 없다', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(200, {
        valid: true,
        stationName: '애월 마을방송국',
        expiresAt: '2026-08-20T00:00:00.000Z',
        maxUploads: 5,
        remainingUploads: 5,
        maxFileSizeBytes: 524_288_000,
      }),
    ) as unknown as typeof fetch;

    const view = await describeResidentLink(deps(fetchFn), TOKEN);
    expect(view.maxFileSizeBytes).toBe(524_288_000);

    const [url, init] = (fetchFn as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(`https://example.test/v1/resident-links/${encodeURIComponent(TOKEN)}`);
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect(JSON.stringify(init.headers)).not.toContain(TOKEN);
    // 무인증 표면 — Authorization을 붙일 토큰 자체가 없다
    expect(Object.keys(init.headers)).not.toContain('Authorization');
  });

  it('404는 ApiClientError(404)로 올라온다 — 화면 게이트가 unknown_link로 수렴시킨다', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(404, { code: 'not_found', message: '유효하지 않은 링크입니다' }),
    ) as unknown as typeof fetch;

    await expect(describeResidentLink(deps(fetchFn), TOKEN)).rejects.toBeInstanceOf(ApiClientError);
  });

  it('fetch 예외는 ApiNetworkError로 바뀌며 메시지에 토큰이 없다', async () => {
    const fetchFn = jest.fn(async () => {
      throw new Error(`request to https://example.test/v1/resident-links/${TOKEN} failed`);
    }) as unknown as typeof fetch;

    const err = await describeResidentLink(deps(fetchFn), TOKEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiNetworkError);
    expect((err as Error).message).not.toContain(TOKEN);
  });
});

describe('createResidentUpload', () => {
  it('제목·분류·자막 필드를 보내지 않는다(간단 모드 강제 — 서버가 받는 필드 자체가 없다)', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(200, {
        uploadId: 'u1',
        uploadUrl: 'https://storage.test/put?sig=x',
        uploadUrlExpiresAt: '2026-08-17T00:15:00.000Z',
        remainingUploads: 4,
        maxFileSizeBytes: 524_288_000,
      }),
    ) as unknown as typeof fetch;

    await createResidentUpload(deps(fetchFn), TOKEN, {
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1024,
    });

    const [url, init] = (fetchFn as unknown as jest.Mock).mock.calls[0];
    expect(url).toBe(`https://example.test/v1/resident-links/${encodeURIComponent(TOKEN)}/uploads`);
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['fileName', 'mimeType', 'sizeBytes']);
    expect(body).not.toHaveProperty('title');
    expect(body).not.toHaveProperty('category');
    expect(body).not.toHaveProperty('scenes');
    expect(body).not.toHaveProperty('consentAgreed');
  });

  it('연락처를 적으면 실린다(07 §3-15 ⓐ, 선택 항목)', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(200, {
        uploadId: 'u1',
        uploadUrl: 'https://storage.test/put',
        uploadUrlExpiresAt: '',
        remainingUploads: 4,
        maxFileSizeBytes: 1,
      }),
    ) as unknown as typeof fetch;

    await createResidentUpload(deps(fetchFn), TOKEN, {
      fileName: 'a.mp4',
      mimeType: 'video/mp4',
      sizeBytes: 1,
      uploaderContact: '010-1234-5678',
    });

    const body = JSON.parse(
      (fetchFn as unknown as jest.Mock).mock.calls[0][1].body as string,
    ) as Record<string, unknown>;
    expect(body.uploaderContact).toBe('010-1234-5678');
  });
});

describe('completeResidentUpload', () => {
  it('POST /v1/resident-links/:token/uploads/:uploadId/complete', async () => {
    const fetchFn = jest.fn(async () =>
      jsonResponse(200, {
        uploadId: 'u1',
        status: 'awaiting_branch_review',
        remainingUploads: 4,
      }),
    ) as unknown as typeof fetch;

    const receipt = await completeResidentUpload(deps(fetchFn), TOKEN, 'u1');
    expect(receipt.status).toBe('awaiting_branch_review');
    expect((fetchFn as unknown as jest.Mock).mock.calls[0][0]).toBe(
      `https://example.test/v1/resident-links/${encodeURIComponent(TOKEN)}/uploads/u1/complete`,
    );
  });
});
