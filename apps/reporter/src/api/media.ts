import type { MediaAccessUrl, MediaAssetId } from '@gachinol/shared';
import type { ApiClient } from './client';

/** GET /v1/media-assets/:id/url — 서명 GET URL(프리뷰 재생·자산 열람). reporter는 자기 지사만 */
export const getMediaAccessUrl = (c: ApiClient, id: MediaAssetId): Promise<MediaAccessUrl> =>
  c.request<MediaAccessUrl>('GET', `/media-assets/${id}/url`);
