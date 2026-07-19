import type {
  ContentId,
  JobId,
  RevisionRequestId,
  SceneId,
  UserId,
  WeeklyRecommendationId,
} from '../common/id';
import type { ISODateString } from '../common/time';

/**
 * 수정요청 (기자·센터·추천 공용).
 * 수정→재생성 루프의 "무엇을 왜 고치는지"는 상태가 아니라 이력 엔티티로 보존한다.
 * 재생성 Job의 입력이 된다.
 */
export const RevisionRequesterRole = {
  /** 기자 셀프 수정 */
  Reporter: 'reporter',
  /** 센터 관제 수정 지시 */
  CenterOperator: 'center_operator',
} as const;
export type RevisionRequesterRole =
  (typeof RevisionRequesterRole)[keyof typeof RevisionRequesterRole];

/** 수정요청 대상 — 콘텐츠 재생성 또는 주간 추천 재생성 */
export type RevisionTarget =
  | { kind: 'content'; contentId: ContentId }
  | { kind: 'recommendation'; recommendationId: WeeklyRecommendationId };

export interface RevisionRequest {
  id: RevisionRequestId;
  target: RevisionTarget;
  requestedByUserId: UserId;
  requesterRole: RevisionRequesterRole;
  /** 수정 지시 원문 — 재생성 Job의 입력 */
  message: string;
  /** 장면 단위 지시 (콘텐츠 대상일 때) */
  sceneNotes?: readonly { sceneId: SceneId; note: string }[];
  createdAt: ISODateString;
  /** 재생성 완료로 해소된 시각 */
  resolvedAt: ISODateString | null;
  /** 이 요청을 반영한 재생성 Job */
  resolvedByJobId: JobId | null;
}
