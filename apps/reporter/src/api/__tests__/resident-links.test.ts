/**
 * 주민 링크 발급 API 소비(T-W2-35, 대장 #147) — AC1.
 *
 * 발급은 인증 표면(`@Roles('reporter','admin')`)이고 기자는 자기 소속 지사로 자동 귀속되므로
 * 클라이언트는 stationId를 보내지 않는다(admin 전용 파라미터를 기자 앱 계약에 노출하지 않는다 —
 * resident-uploads.ts의 stationId 배제와 같은 판단).
 */
import { issueResidentLink } from '../resident-links';
import type { IssuedResidentLink } from '../resident-links';
import type { ApiClient } from '../client';

const issued: IssuedResidentLink = {
  id: 'link-1',
  token: 'tok-256bit-csprng',
  stationId: 'station-1',
  stationName: '애월지사',
  expiresAt: '2026-08-31T12:00:00.000Z',
  maxUploads: 5,
  remainingUploads: 5,
  maxFileSizeBytes: 500 * 1024 * 1024,
};

test('POST /resident-links 로 발급을 요청하고 서버 응답을 그대로 반환한다', async () => {
  const request = jest.fn().mockResolvedValue(issued);
  const client = { request } as unknown as ApiClient;

  await expect(issueResidentLink(client)).resolves.toEqual(issued);

  // body는 명시적 빈 객체 — zod DTO(zIssueResidentLink)가 객체를 기대하므로 본문 생략으로
  // Content-Type 없는 요청을 만들지 않는다.
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith('POST', '/resident-links', { body: {} });
});
