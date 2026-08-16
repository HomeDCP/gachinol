import type { ChannelAccountId, ContentId, SceneId, StationId, UserId } from '../common/id';
import type { ISODateString, Timestamps } from '../common/time';
import type { CultureTopic, ProgramCategory } from './category';
import type { ContentStatus, ReviewPolicy } from './workflow';

export const ContentPriority = {
  Normal: 'normal',
  Urgent: 'urgent',
} as const;
export type ContentPriority = (typeof ContentPriority)[keyof typeof ContentPriority];
// category='emergency'인 콘텐츠 생성 시 priority 기본값 'urgent' (서버 규칙)

/** 콘텐츠 유래 — 기자 촬영물 · 라이브 VOD · 주민 임시 업로드. reporterId 유무와 검토 경로가 이 값으로 갈린다 */
export const ContentOrigin = {
  /** 기자 앱 촬영·업로드 (기본) */
  ReporterUpload: 'reporter_upload',
  /** 라이브 종료 후 녹화본 전환 (LiveSession.vodContentId가 역참조) */
  LiveVod: 'live_vod',
  /**
   * 무인증 주민 임시 업로드 링크로 수집된 제보 (03 §C-5 · 02 §D-T9).
   * 담당 기자가 없어 reporterId=null이고, **지사 담당자 검수 승인 전에는 정식 파이프라인
   * (processing 이후)에 진입하지 않는다** — 이 게이트의 서버측 강제는 api resident-links 모듈이
   * 소유하며, 승인 상태는 ContentStatus가 아니라 별도 테이블 컬럼으로 표현한다(상태 23종 불변).
   */
  ResidentLink: 'resident_link',
} as const;
export type ContentOrigin = (typeof ContentOrigin)[keyof typeof ContentOrigin];

/** 촬영물 애그리거트 루트 */
export interface Content extends Timestamps {
  id: ContentId;
  /** 담당 지사 (origin='live_vod'면 라이브 주관국) */
  stationId: StationId;
  /** 유래 판별 — 검토 경로(workflow.ts preview_generating 분기)와 reporterId 불변식의 근거 */
  origin: ContentOrigin;
  /**
   * 담당 기자 (ReporterUser).
   * 서버 불변식: non-null ⇔ origin='reporter_upload'. 나머지 유래는 담당 기자가 없어 null이다 —
   * origin='live_vod'는 기자 승인 게이트를 생략하고 센터 검토로 직행하고(workflow.ts 참조),
   * origin='resident_link'는 업로더가 무인증 주민이라 지사 담당자 검수 승인을 별도 게이트로 거친다.
   */
  reporterId: UserId | null;
  title: string;
  description?: string;
  category: ProgramCategory;
  /** category='culture'일 때만 non-empty (서버 불변식) */
  cultureTopics?: readonly CultureTopic[];
  status: ContentStatus;
  /** urgent = Job 큐 최우선 + 분석 생략 패스트트랙 근거 */
  priority: ContentPriority;
  reviewPolicy: ReviewPolicy;
  /** 산출물 세대. 최초 1, 수정 반영 재생성마다 +1 — MediaAsset·AiAnalysis가 같은 번호로 정합 */
  generation: number;
  /** 장면 배열 (order 오름차순). phase-1 DB는 contents.scenes JSONB, 장면 단위 접근이 필요해지면 별도 테이블로 정규화(후속) */
  scenes: readonly Scene[];
  /** 사전 지정 송출처. 기본값: 기자 소속 지사의 kakao ChannelAccount 1개, origin='live_vod'는 라이브 세션의 targetChannelAccountIds 승계 (서버 규칙) */
  targetChannelAccountIds: readonly ChannelAccountId[];
  /** AI 태깅 결과 비정규화 사본 (검색·필터용, 원본은 AiAnalysis) */
  tags: readonly string[];
  /** 반려된 콘텐츠를 재작업한 새 콘텐츠일 때 원본 참조 */
  remakeOfContentId?: ContentId;
  /** 최근 실패 상세 (실패 지점은 status 자체가 표현) */
  lastError?: { message: string; at: ISODateString };
  /** 편집 완료 후 확정 */
  durationSec: number | null;
  /** 승인자 — "누가 승인했나" */
  approvedByUserId: UserId | null;
  approvedAt: ISODateString | null;
  /**
   * 미성년자(만 14세 미만) 피촬영자 동의 게이트 (07 §3-3·02 §E-20, T-W2-13/T-W2-23) — 개인정보 최소수집:
   * 아동 식별정보 컬럼 없음, 14세 미만 등장 여부 불린 + 확인자·확인시각만 다룬다.
   */
  hasMinorSubject: boolean;
  /** 법정대리인 동의서 확인자(센터) — fail-closed 판정 근거: null=미확인 */
  minorConsentConfirmedByUserId: UserId | null;
  minorConsentConfirmedAt: ISODateString | null;
  /** 비정규화: 최초 송출 완료 시각 — "지사별 최신 콘텐츠" 정렬 키. 인덱스 (station_id, status, published_at DESC) */
  publishedAt: ISODateString | null;
}

/** 장면 단위 자막·설명. (contentId, order) unique */
export interface Scene {
  id: SceneId;
  /** 0부터 */
  order: number;
  /** 자막 (화면 노출) */
  caption: string;
  /** 설명·편집 지시 (자동편집·AI 분석 힌트) */
  description?: string;
  /** 원본 기준 구간. 업로드 전 미정 가능 */
  startSec: number | null;
  endSec: number | null;
  /** 처리 후 서버가 채움 */
  thumbnailUrl?: string;
}

/** 목록용 축약 DTO (비정규화 필드 포함) */
export interface ContentSummary {
  id: ContentId;
  title: string;
  category: ProgramCategory;
  status: ContentStatus;
  stationId: StationId;
  /** 비정규화 */
  stationName: string;
  /** origin='live_vod'면 null (Content.reporterId와 동일 규약) */
  reporterId: UserId | null;
  /** 비정규화 — reporterId=null이면 null */
  reporterName: string | null;
  thumbnailUrl?: string;
  /** 엔티티(Content.durationSec)와 동일하게 부재를 null로 표현 — wire format 통일 */
  durationSec: number | null;
  createdAt: ISODateString;
  publishedAt: ISODateString | null;
}
