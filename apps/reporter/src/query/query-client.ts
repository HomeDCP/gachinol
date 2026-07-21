import { QueryClient } from '@tanstack/react-query';
import { isApiClientError } from '../api/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // 4xx 재시도 무익 (401은 클라이언트 인터셉터 몫)
        retry: (count, err) => !(isApiClientError(err) && err.status < 500) && count < 2,
      },
      // 전이는 멱등 아님(CAS) — 자동 재시도 금지
      mutations: { retry: 0 },
    },
  });
}
