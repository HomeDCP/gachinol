import type { ProcessingState } from '@gachinol/shared';
import type { ApiClient } from './client';

/**
 * GET /v1/system/processing-state — 미디어 처리 게이트 상태.
 * 백엔드가 DCP 파이프라인과 호스트를 공유할 때, DCP 작업 중에는 큐가 정지한다.
 * 게이트가 없는 환경에서는 `enabled=false`(상시 처리 가능)로 응답한다.
 */
export const getProcessingState = (c: ApiClient): Promise<ProcessingState> =>
  c.request<ProcessingState>('GET', '/system/processing-state');
