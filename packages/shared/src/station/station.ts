import type { StationId } from '../common/id';
import type { ISODateOnlyString, ISODateString, Timestamps } from '../common/time';

/**
 * 허브 앤 스포크. 센터 = `kind: 'center'`인 Station 정확히 1행(DB partial unique index),
 * 지사 = `branch` 12행. 12개 지사 목록은 타입이 아니라 DB 시드 데이터.
 * 현재 시드: 애월·제주시 = dormant, 나머지 10곳 = planned, 센터 = operating.
 */
export const StationKind = {
  /** 제주방송센터 (허브·컨트롤타워) */
  Center: 'center',
  /** 마을방송국 지사 */
  Branch: 'branch',
} as const;
export type StationKind = (typeof StationKind)[keyof typeof StationKind];

export const StationStatus = {
  /** 운영 중 */
  Operating: 'operating',
  /** 설립됐으나 휴무 (현재: 애월·제주시) */
  Dormant: 'dormant',
  /** 설립 예정 */
  Planned: 'planned',
} as const;
export type StationStatus = (typeof StationStatus)[keyof typeof StationStatus];

export const STATION_STATUS_TRANSITIONS = {
  planned: ['operating'],
  operating: ['dormant'],
  /** 휴무 지사 부활 (MVP: 애월·제주시) */
  dormant: ['operating'],
} as const satisfies Record<StationStatus, readonly StationStatus[]>;

export interface Station extends Timestamps {
  id: StationId;
  /** unique slug (예: 'center', 'aewol', 'jeju-si') — URL·room 네이밍 키 */
  code: string;
  /** 예: '애월 마을방송국' */
  name: string;
  kind: StationKind;
  status: StationStatus;
  /** 행정구역 자유 표기 (예: '제주시 애월읍') — 열거화하지 않음 (N 확장 대응) */
  region: string;
  description?: string;
  /** 구독자 앱 지사 카드 이미지 */
  thumbnailUrl?: string;
  /**
   * 지사 공개 대표번호 (예: '064-000-0000'). **미설정이 정상** — 없으면 앱은 "전화" 대체 경로를
   * 아예 숨긴다(누를 수 없는 버튼을 보여주지 않는다).
   *
   * ⚠️ PII 판정 근거 (2026-08-16 사용자 결정 · 대장 #127):
   * `packages/shared/src/user/community-figure.ts`가 "연락처(전화번호)는 개인정보라 공용 계약에서
   * 제외"한 대상은 **개인**(이장·촌장·삼춘 등 CommunityFigure)의 연락처다. 이 필드는 개인이 아니라
   * **조직(지사)의 공개 업무 연락처** — 방송·홍보물에 이미 공개되는 대표번호이므로 성격이 다르고,
   * 공개 계약(StationSummary)에 실어 지사별로 다른 값을 줄 수 있어야 한다.
   * **개인 휴대번호를 이 필드에 넣지 않는다** — 넣는 순간 위 구분이 무너진다.
   */
  supportTel?: string;
  /**
   * 지사 공식 YouTube 채널·라이브 URL. 재생 실패 폴백(03 §A-6)의 "유튜브에서 보기" 대체 경로가
   * 지사 단위로 성립하게 하는 원천 — 미설정이면 앱이 그 경로를 숨긴다.
   * (앱 env `EXPO_PUBLIC_LIVE_YOUTUBE_URL`은 지사를 특정할 수 없는 화면의 최후 수단으로만 남는다.)
   */
  youtubeUrl?: string;
  /** "한 화면에서 전 지사 나열" 정렬 순서 */
  sortOrder: number;
  foundedAt?: ISODateOnlyString;
  /** status='dormant'일 때 */
  dormantSince?: ISODateString;
}

/**
 * 구독자 앱 지사 목록용 축약 DTO.
 * 공개 연락 채널(supportTel·youtubeUrl)은 **공개 목적의 필드라 축약에도 포함**한다 — 재생 실패
 * 폴백의 대체 경로가 지사별로 성립하려면 익명 응답(`GET /v1/feed/stations`)에 실려야 한다.
 * PII 판정 근거는 위 `Station.supportTel` 주석.
 */
export interface StationSummary {
  id: StationId;
  name: string;
  region: string;
  status: StationStatus;
  thumbnailUrl?: string;
  supportTel?: string;
  youtubeUrl?: string;
}
