import { QueryClient } from '@tanstack/react-query';
import { isApiClientError } from '../api/errors';

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        // 4xx 재시도 무익 (published-only 공개 GET — 서버 판정 확정)
        retry: (count, err) => !(isApiClientError(err) && err.status < 500) && count < 2,
      },
    },
  });
}
