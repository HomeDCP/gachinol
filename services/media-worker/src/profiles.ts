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

export interface AutoEditProfile {
  height: number;
  vbrKbps: number;
  loudnormI: number;
  /** 함께 갱신하는 배포 렌디션 label — transcode와 같은 규약이라 key가 덮어써진다 */
  renditionLabel: string;
}

/**
 * auto_edit — 렌디션과 **같은 규격**으로 낸다. 그래야 산출된 720p가 기존 배포 렌디션을
 * (bucket, storageKey) 기준으로 덮어써 배포본이 편집 결과로 교체된다.
 */
export function autoEditProfile(env: WorkerEnv): AutoEditProfile {
  const height = env.MEDIA_RENDITION_HEIGHT;
  return {
    height,
    vbrKbps: env.MEDIA_RENDITION_VBR_KBPS,
    loudnormI: env.MEDIA_LOUDNORM_I,
    renditionLabel: `${height}p`,
  };
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
/** 자동편집 마스터 — 자막을 굽지 않은 '깨끗한' 편집본. 재편집·아카이브의 소스가 된다 */
export const editedMasterKey = (prefix: string): string => `${prefix}edited-master.mp4`;
export const previewKey = (prefix: string): string => `${prefix}preview.mp4`;
export const thumbnailKey = (prefix: string): string => `${prefix}thumbnail.jpg`;
