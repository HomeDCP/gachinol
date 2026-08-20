import type { MediaAssetId } from '../common/id';

/**
 * 자동편집 지시서(EditPlan) — `auto_edit` 잡의 **선택적** 입력.
 *
 * ★ 핵심 설계: **auto_edit은 EditPlan에 의존하지 않는다.**
 * `null`이거나 `segments`가 비면 워커는 컷 없이 "기계편집"(음량 정규화·렌디션·faststart)만 한다.
 * 이 성질이 있어야 ⓐ AI·맥 추론 노드가 없어도 파이프라인이 완주하고(Phase 1),
 * ⓑ 추론 노드가 죽어도 degraded 경로로 영상이 나온다(T-AI 트랙).
 * 근거: 2026-08-17 PoC — FFmpeg 기계편집만으로 8.7초·AI 호출 0회에 132MB→14MB·-26.2→-20.0dB.
 *
 * ⚠️ Phase 1에서는 이 계약을 **세우기만 하고 채우지 않는다**(항상 null). 실제로 `segments`를
 * 채우는 주체는 글콘티(Storyboard) 기자 선택이며 T-AI 트랙 소관이다.
 */

/** 남길 구간 1개 — 시각은 **항상 편집 소스 기준**이다(§TimelineMapping 참조) */
export interface EditPlanSegment {
  startSec: number;
  endSec: number;
}

export interface EditPlan {
  /**
   * 남길 구간을 **이 배열 순서대로** 이어붙인다. 비었거나 미지정이면 컷 없음(전체 유지).
   * 구간끼리 겹쳐도 되고(같은 장면 재사용) 원본 순서를 벗어나도 된다 — 순서는 배열이 정한다.
   */
  segments?: readonly EditPlanSegment[];
  /**
   * 이미 만든 `edited_master`를 그대로 두고 **스타일(자막 번인 등)만 다시 입힐 때** 지정한다.
   * 컷을 다시 하지 않으므로 렌디션 1패스로 끝난다(T-AI 트랙 §6-C).
   */
  reuseMasterAssetId?: MediaAssetId;
}

/**
 * 편집 전/후 타임라인 대응 — **worker만이 정확한 오프셋을 안다**(재프로브로 복원 불가)라
 * `JobResultMap.auto_edit`에 실려 api로 돌아온다.
 *
 * ★ 왜 필요한가: `Scene.startSec`는 "원본 기준 구간"인데(`content/content.ts`),
 * 구독자 피드의 자막 오버레이(`feed.mapper.ts` `scenesToCaptions`)는 **배포본 타임라인**을
 * 전제한다. 컷이 들어가면 둘이 어긋나므로 api가 이 매핑으로 Scene 시각을 재기입해야 한다.
 *
 * Phase 1은 컷을 하지 않으므로(`silenceremove` 제외) 이 매핑이 **항등**이다
 * (`source* === output*`, 원소 1개). 그래서 자막이 밀리지 않는다.
 */
export interface TimelineMapping {
  sourceStartSec: number;
  sourceEndSec: number;
  outputStartSec: number;
  outputEndSec: number;
}

/** 컷 지시가 실제로 있는가 — 워커·api가 공유하는 유일 판정(사본 금지) */
export const hasCutInstructions = (plan: EditPlan | null | undefined): boolean =>
  !!plan?.segments && plan.segments.length > 0;

/**
 * 재생성 중복 방지용 안정 해시 입력 문자열.
 * ⚠️ `EditPlan`이 **없으면 비교 대상이 아니다** — Phase 1은 plan이 항상 null이라
 * 해시가 늘 같아 "변경 없음" 판정에 걸리면 재생성이 영구 거부된다(2차 리뷰 N-2).
 * 그래서 호출측은 `hasCutInstructions()`가 참일 때만 비교한다.
 */
export const editPlanFingerprint = (plan: EditPlan): string =>
  JSON.stringify({
    s: (plan.segments ?? []).map((x) => [x.startSec, x.endSec]),
    r: plan.reuseMasterAssetId ?? null,
  });
