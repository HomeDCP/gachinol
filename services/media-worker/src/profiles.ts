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

export interface MasterProfile {
  height: number;
  vbrKbps: number;
}

/**
 * 송출 마스터(대장 #232 태스크①) — YouTube/카카오 등 고화질 송출 원천의 규격.
 * 렌디션(720p·MVP 시연용)과 분리됐다. 값은 env 기본값 그대로 쓰는 게 정상 경로다.
 */
export function masterProfile(env: WorkerEnv): MasterProfile {
  return { height: env.MEDIA_MASTER_HEIGHT, vbrKbps: env.MEDIA_MASTER_VBR_KBPS };
}

export interface AutoEditProfile {
  /** 소스 → 마스터 1차 인코딩 규격(고화질, closed GOP) */
  master: MasterProfile;
  /** 마스터 → 배포 렌디션 2차 인코딩 규격(기존 720p 배포본과 같은 key 규약) */
  rendition: RenditionProfile;
  loudnormI: number;
}

/**
 * auto_edit 프로파일 = 마스터 규격 + 렌디션 규격.
 * ⚠️ 렌디션은 더 이상 송출 마스터가 아니다 — **마스터에서** 뜬 축소판일 뿐이며,
 * 여전히 기존 배포 렌디션과 같은 key 규약(`renditionKey`)이라 (bucket, storageKey) 기준으로
 * 덮어써 배포본이 편집 결과로 교체된다.
 */
export function autoEditProfile(env: WorkerEnv): AutoEditProfile {
  const renditionHeight = env.MEDIA_RENDITION_HEIGHT;
  return {
    master: masterProfile(env),
    rendition: {
      height: renditionHeight,
      vbrKbps: env.MEDIA_RENDITION_VBR_KBPS,
      label: `${renditionHeight}p`,
    },
    loudnormI: env.MEDIA_LOUDNORM_I,
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
