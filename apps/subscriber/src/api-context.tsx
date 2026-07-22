import { createContext, useContext, useRef } from 'react';
import type { PropsWithChildren } from 'react';
import { createPublicApiClient, type PublicApiClient } from './api/client';
import { getApiBaseUrl } from './config/env';

/**
 * 공개 GET 전용 클라이언트를 앱 트리에 1회 생성해 공유한다.
 * AuthProvider 없음 — 익명 시청이라 세션·토큰 개념이 없다.
 */
const ApiContext = createContext<PublicApiClient | null>(null);

export function ApiProvider({ children }: PropsWithChildren): React.JSX.Element {
  const ref = useRef<PublicApiClient | null>(null);
  if (ref.current === null) {
    ref.current = createPublicApiClient({ baseUrl: getApiBaseUrl() });
  }
  return <ApiContext.Provider value={ref.current}>{children}</ApiContext.Provider>;
}

export function useApiClient(): PublicApiClient {
  const ctx = useContext(ApiContext);
  if (!ctx) throw new Error('useApiClient는 ApiProvider 안에서만 사용할 수 있습니다');
  return ctx;
}
