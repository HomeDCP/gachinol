import type { ContentId, JobId, LiveSessionId, MediaAssetId } from '../common/id';
import type { ISODateString } from '../common/time';

/**
 * 미디어 산출물. `storageKey`가 원본 좌표.
 * 클라이언트 접근 URL은 서명 발급 API(MediaAccessUrl)로만 — DTO에 영구 URL을 넣지 않는다
 * (공개 썸네일·상품 이미지는 예외적으로 CDN URL 허용).
 * 조회 인덱스 권고: (content_id, kind, generation) — "이 콘텐츠의 현 세대 프리뷰/썸네일" 단건 조회가 최빈.
 */
export const MediaAssetKind = {
  /** 기자 업로드 원본 */
  Original: 'original',
  /** 자동편집 결과 마스터 */
  EditedMaster: 'edited_master',
  /** 트랜스코딩 산출물 (해상도별) */
  Rendition: 'rendition',
  /** 기자 승인용 저화질 프리뷰 ★ */
  Preview: 'preview',
  Thumbnail: 'thumbnail',
  /** HLS 패키징 (storageKey = master.m3u8, 세그먼트는 키 prefix 규칙) */
  Hls: 'hls',
} as const;
export type MediaAssetKind = (typeof MediaAssetKind)[keyof typeof MediaAssetKind];

export const MediaAssetStatus = {
  Pending: 'pending',
  Ready: 'ready',
  Failed: 'failed',
  Deleted: 'deleted',
} as const;
export type MediaAssetStatus = (typeof MediaAssetStatus)[keyof typeof MediaAssetStatus];

/** 소유 주체 — 녹화 콘텐츠 XOR 라이브 (판별 유니언으로 타입 수준 XOR) */
export type MediaAssetOwner =
  { kind: 'content'; contentId: ContentId } | { kind: 'live'; liveSessionId: LiveSessionId };

export interface MediaAsset {
  id: MediaAssetId;
  owner: MediaAssetOwner;
  kind: MediaAssetKind;
  status: MediaAssetStatus;
  /** Content.generation과 대응 — 재생성 루프에서 이전 산출물과 구분. original은 항상 1 */
  generation: number;
  /** 미지정 시 기본 버킷 */
  bucket?: string;
  /** 오브젝트 키 (예: 'contents/{contentId}/g2/preview.mp4'). (bucket, storageKey) unique */
  storageKey: string;
  mimeType: string;
  sizeBytes?: number;
  durationSec?: number;
  width?: number;
  height?: number;
  bitrateKbps?: number;
  videoCodec?: string;
  audioCodec?: string;
  /** '1080p' · '720p' · 'preview-360p' 등 자유 문자열 (프로파일은 media-worker 설정) */
  renditionLabel?: string;
  /** 무결성·B2B 납품 검증 */
  checksumSha256?: string;
  /** 원본은 없음 */
  createdByJobId?: JobId;
  createdAt: ISODateString;
}

/** GET /media-assets/:id/url — 서명 URL 발급 응답 */
export interface MediaAccessUrl {
  url: string;
  expiresAt: ISODateString;
}
