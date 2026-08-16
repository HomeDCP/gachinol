import { useMemo } from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { getApiBaseUrl } from '../config/env';
import {
  describeResidentLink,
  type ResidentLinkApiDeps,
  type ResidentLinkPublicView,
} from './resident-link-api';

/**
 * 주민 업로드 링크 조회 훅 — 화면과 서버 사이의 유일한 배선 지점(T-W2-09).
 *
 * 훅을 별도 모듈로 뽑는 이유는 리포 관례 그대로다: 화면 렌더 테스트가 이 모듈만 목으로 바꿔
 * (`jest.mock('../queries')`) 서버·환경변수 없이 전 상태를 재현한다(`feed/queries.ts` 선례).
 */

export function useResidentLinkApi(): ResidentLinkApiDeps {
  return useMemo(() => ({ baseUrl: getApiBaseUrl() }), []);
}

/**
 * `token`이 null이면 요청 자체를 보내지 않는다(게이트가 먼저 missing_token으로 끝낸다).
 * `retry: false` — 404(없는 링크)·403은 재시도해도 결과가 같아 사용자를 기다리게 할 뿐이다.
 * `staleTime: 0` — 남은 횟수·만료는 업로드마다 변하므로 캐시로 굳히지 않는다.
 */
export function useResidentLink(
  api: ResidentLinkApiDeps,
  token: string | null,
): UseQueryResult<ResidentLinkPublicView> {
  return useQuery({
    // 캐시 키에만 토큰이 들어간다(메모리 한정) — 로그·URL 파라미터·전송 본문에는 추가하지 않는다
    queryKey: ['resident-link', token],
    queryFn: () => describeResidentLink(api, token as string),
    enabled: token !== null,
    retry: false,
    staleTime: 0,
  });
}
