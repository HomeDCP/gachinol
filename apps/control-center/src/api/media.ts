import type { MediaAccessUrl, MediaAssetId } from '@gachinol/shared';
import type { ApiClient } from './client';

/** GET /v1/media-assets/:id/url — 서명 GET URL(프리뷰 재생·자산 열람). 센터·admin은 전 지사 열람 */
export const getMediaAccessUrl = (c: ApiClient, id: MediaAssetId): Promise<MediaAccessUrl> =>
  c.request<MediaAccessUrl>('GET', `/media-assets/${id}/url`);
