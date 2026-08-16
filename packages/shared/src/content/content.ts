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
  /**
   * 미성년자(만 14세 미만) 피촬영자 동의 게이트의 목록 투영 (T-W2-27, 대장 #118).
   *
   * 왜 축약 DTO에까지 있는가: 게이트를 확인하는 액터는 **센터 전용**인데
   * `reviewPolicy='reporter_only'`(교양·날씨)는 센터 검토를 아예 거치지 않는다. 플래그가 켜진 채
   * 미확인이면 기자 승인이 차단되지만, 이 필드가 목록에 없으면 센터는 그런 콘텐츠가 **존재한다는
   * 사실 자체**를 알 수 없었다(발견 경로가 상세 1건씩 전수 조회뿐 → 교착).
   *
   * ⚠ 이 두 필드를 직접 비교하지 말고 `isMinorConsentPending()`으로 판정할 것 — 같은 술어를
   * api 승인 가드(policyGuard ④)와 관제 보드가 공유한다(사본 금지).
   */
  hasMinorSubject: boolean;
  /** 확인자 id는 상세(`Content`)에만 둔다 — 목록에 필요한 건 "확인됐는가"뿐(노출 최소화) */
  minorConsentConfirmedAt: ISODateString | null;
  createdAt: ISODateString;
  publishedAt: ISODateString | null;
}

/**
 * 미성년자 동의 게이트 판정의 입력 — 확인 시각의 **표현에 중립**이다
 * (wire의 ISO 문자열 / Prisma row의 `Date`). 표현이 갈린다고 규칙이 복제되면 안 되기 때문에
 * 한 술어가 양쪽을 다 받는다.
 */
export interface MinorConsentFacts {
  readonly hasMinorSubject: boolean;
  readonly minorConsentConfirmedAt: ISODateString | Date | null;
}

/**
 * ★ "동의 확인 대기" 판정 — 미성년자 게이트가 승인을 막고 있는 상태인가.
 * 규칙의 **유일 원천**이다: api 승인 가드(`content-workflow.service.ts` policyGuard ④)와
 * 관제 보드의 발견 수단(필터·배지)이 둘 다 여기서 파생한다.
 *
 * `approvedAt`은 판정에 쓰지 않는다 — `approve()`가 모든 reviewPolicy의 **기자 승인 hop**에서도
 * 채우므로 "게이트를 통과했다"의 프록시가 아니다(T-W2-23 D5 정정). 이미 승인이 났는지를 알아야
 * 하는 곳(동의 철회 가능 여부)은 `status_transition_logs` 실측을 쓴다 —
 * `contents.service.ts` `withdrawMinorConsent()` 참조. 이 술어는 그것과 다른 질문
 * ("확인이 아직 안 됐는가")에 답하며, 원천은 `minor_consent_confirmed_at` 컬럼 하나다.
 */
export const isMinorConsentPending = (c: MinorConsentFacts): boolean =>
  c.hasMinorSubject && c.minorConsentConfirmedAt === null;

/**
 * `GET /v1/contents`의 미성년자 동의 게이트 필터 값 (T-W2-27, 대장 #118).
 * 두 값 모두 `hasMinorSubject=true`인 콘텐츠만 남긴다(플래그가 꺼진 대다수는 이 축과 무관).
 * **사실 필터다** — 종결(rejected·canceled) 상태를 제외하지 않는다. "조치가 필요한가"는
 * 상태와 함께 보는 소비자 판단이라 서버가 상태 목록을 사본으로 갖지 않는다.
 */
export const MinorConsentFilter = {
  /** 미확인 — 센터가 확인해야 승인이 풀리는 대기열 */
  Pending: 'pending',
  /** 확인 완료 — 감사·역추적용 */
  Confirmed: 'confirmed',
} as const;
export type MinorConsentFilter = (typeof MinorConsentFilter)[keyof typeof MinorConsentFilter];

/**
 * `GET /v1/contents`의 자막 대기열 필터 (T-W2-34, 대장 #123).
 *
 * 간단 모드(03 §C-4)로 올린 콘텐츠와 주민 제보(`origin='resident_link'`)는 `scenes`가 빈 배열로
 * 저장된다 — 자막은 지사 담당자가 **사후에** 채운다. 이 필터가 그 대기열의 **유일한 발견 경로**다
 * (없으면 자막 미완 콘텐츠는 상세를 1건씩 전수 조회해야만 찾을 수 있어, 편집 화면만 만들고
 * 진입로가 없던 대장 #118과 같은 형태의 결함이 된다).
 *
 * ⚠ `MinorConsentFilter`와 달리 **순수 사실 필터가 아니다**. `needed`는 "자막이 없다"에
 * "**지금 채울 수 있다**"(`isCaptionEditableStatus`)를 곱한 값이다 — 이미 송출됐거나 종결된
 * 콘텐츠는 자막을 채워도 반영할 곳이 없어(쓰기 경로가 409로 거부한다) 대기열에 남겨 두면
 * 영원히 줄지 않는 유령 항목이 된다. 두 판정 모두 shared `CAPTION_EDITABLE_CONTENT_STATUSES`
 * 하나에서 파생하므로 필터와 쓰기 게이트가 어긋날 수 없다.
 *
 * 값이 하나뿐인 것은 의도다 — "자막이 있는 것"을 골라내야 하는 소비자가 아직 없다.
 */
export const CaptionFilter = {
  /** 자막 0건 ∧ 아직 채울 수 있는 상태 — 지사 담당자의 작업 대기열 */
  Needed: 'needed',
} as const;
export type CaptionFilter = (typeof CaptionFilter)[keyof typeof CaptionFilter];
