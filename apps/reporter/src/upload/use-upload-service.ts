import { useMemo } from 'react';
import { useApiClient } from '../auth/auth-context';
import { createHttpUploadService } from './http-upload-service';
import type { UploadService } from './upload-service';

/**
 * ★ 교체 지점 — 화면은 이 훅으로 UploadService를 얻는다.
 * uploadService 모듈 싱글턴은 인증된 ApiClient(AuthProvider 컨텍스트 생성)에 닿지 못하므로,
 * 실 구현은 훅으로 client를 주입한다. (테스트/스토리북은 mockUploadService 직접 사용)
 */
export function useUploadService(): UploadService {
  const client = useApiClient();
  return useMemo(() => createHttpUploadService(client), [client]);
}
