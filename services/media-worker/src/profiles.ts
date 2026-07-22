import type { JobPayloadMap } from '@gachinol/shared';
import type { WorkerEnv } from './env';

/**
 * 프로파일 = env 기본값 + job payload 오버라이드 결합.
 * 산출물 key·label 규약은 shared 계약(mediaOutputKeyPrefix + 파일명) 준수 —
 * api가 key를 검증 없이 그대로 upsert하므로 worker가 규약을 지켜야 한다.
 */

export interface RenditionProfile {
  height: number;
  vbrKbps: number;
  label: string;
}
export interface PreviewProfile {
  maxHeight: number;
  maxBitrateKbps: number;
  label: string;
}
export interface ThumbnailProfile {
  width: number;
  atSec: number;
}

/** transcode — 렌디션 높이는 env, label은 `${height}p`(payload.renditionLabels 첫값이 있으면 우선) */
export function renditionProfile(
  env: WorkerEnv,
  payload: JobPayloadMap['transcode'],
): RenditionProfile {
  const height = env.MEDIA_RENDITION_HEIGHT;
  const label = payload.renditionLabels[0] ?? `${height}p`;
  return { height, vbrKbps: env.MEDIA_RENDITION_VBR_KBPS, label };
}

/** preview — payload.maxHeight/maxBitrateKbps 우선, 미지정 시 env 기본값. label='preview-360p' 규약 */
export function previewProfile(
  env: WorkerEnv,
  payload: JobPayloadMap['preview'],
): PreviewProfile {
  const maxHeight = payload.maxHeight || env.MEDIA_PREVIEW_HEIGHT;
  const maxBitrateKbps = payload.maxBitrateKbps || env.MEDIA_PREVIEW_BITRATE_KBPS;
  return { maxHeight, maxBitrateKbps, label: `preview-${maxHeight}p` };
}

/** thumbnail — 전량 env */
export function thumbnailProfile(env: WorkerEnv): ThumbnailProfile {
  return { width: env.MEDIA_THUMBNAIL_WIDTH, atSec: env.MEDIA_THUMBNAIL_AT_SEC };
}

/** 산출물 key 규약 헬퍼 — outputKeyPrefix 하위 파일명 */
export const renditionKey = (prefix: string, label: string): string =>
  `${prefix}rendition/${label}.mp4`;
export const previewKey = (prefix: string): string => `${prefix}preview.mp4`;
export const thumbnailKey = (prefix: string): string => `${prefix}thumbnail.jpg`;
