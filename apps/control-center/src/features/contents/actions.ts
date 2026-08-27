import type { Content } from '@gachinol/shared';
import {
  CONTENT_STATUS_TRANSITIONS,
  ContentStatus,
  canTransitionContent,
  isAutoProgressContentStatus,
  isFailureStatus,
} from '@gachinol/shared';

/**
 * 센터 결정·재시도 게이팅 — 전이 맵 사본 금지, shared 상태·헬퍼 재사용.
 * 센터는 지사 횡단 권한이라 소유권 비의존.
 */
export interface CenterActions {
  /** 승인/수정요청/반려 — awaiting_center_review에서 셋 다 항상 허용(workflow.ts) */
  canDecide: boolean;
  /** 실패 6종 재시도 (목적지는 CONTENT_RETRY_TARGET) */
  canRetry: boolean;
  /**
   * 다채널 송출 지시 — center_approved에서만.
   * 승인과 송출은 분리돼 있다: reporter_only는 기자 승인이 publishing으로 자동 연쇄하지만
   * (shared afterReporterApproval), reporter_then_center는 센터 승인 후 center_approved에서
   * 멈추고 여기서 사람이 송출을 지시한다. 서버 `POST /contents/:id/distribute`도 같은 상태만 받는다.
   */
  canDistribute: boolean;
  /**
   * ★ 보관(archive) 지시 — `manualTransitionTargets`에 보관 목적지가 들어 있을 때만 (대장 #124).
   *
   * 별도 플래그로 뽑는 이유: 보관은 "워커 부재기 임시 탈출구"(아래 manualTransitionTargets의 취지)와
   * 성격이 완전히 다르다. **되돌릴 수 없는 제품 액션**(공개 객체 삭제 + CDN 캐시 퍼지 —
   * services/api/src/media/public-media.service.ts `removePublishedCopies`)이라 "직접 전이(임시 조치)"
   * 라벨 아래 묻히면 안 되고, 전용 경고 문구와 확인 다이얼로그를 받아야 한다.
   * 운반 수단만 범용 수동 전이를 재사용한다(전용 엔드포인트 신설 안 함 — 사용자 결정 2026-08-16).
   *
   * 조건 자체는 상태 이름이 아니라 **목적지 존재 여부**에서 파생한다 — 보관 액션의 정체는
   * "목적지가 archived인 전이"이고, shared 전이맵이 그 도달 가능성의 유일 원천이다.
   */
  canArchive: boolean;
  /**
   * 수동 전이 목적지 — 센터가 지시하지 않으면 아무도 옮기지 않는 상태의 진행 수단.
   * `POST /v1/contents/:id/transitions`(서버 실재) 소비용. shared `CONTENT_STATUS_TRANSITIONS[status]`
   * 에서 파생(사본 금지 — `features/live/labels.ts`의 availableLifecycleActions 선례).
   * 빈 배열 = 버튼 미노출. 열리는 상태의 판정은 `centerActionsFor` 주석 참조(상태 이름 비교 0).
   */
  manualTransitionTargets: readonly ContentStatus[];
  /**
   * ★ 다시 만들기 — `revision_requested`에서 auto_edit 재생성을 시작한다(대장 #98).
   *
   * 전용 액션으로 뽑는 이유: auto_edit이 구동되면서 `regenerating`이 자동 진행 상태가 됐고,
   * 그 결과 아래 `manualTransitionTargets`의 ③ 조건("나가는 길 끝에 자동 진행 상태가 없다")에
   * 걸려 범용 수동 전이 탈출구가 **자동으로 닫힌다**. 그런데 범용 전이(`POST /transitions`)는
   * auto_edit 잡을 인큐하지 않으므로 그 길로 가면 또 멈춘다 — 진짜 경로는 전용 엔드포인트
   * `POST /v1/contents/:id/regenerate`(커밋 후 인큐)뿐이고, 이 플래그가 그 버튼을 연다.
   */
  canRegenerate: boolean;
}

/**
 * ★ 수동 전이 탈출구를 여는 조건 — 상태 이름 목록이 아니라 **파생 술어**다.
 *
 * 유일 기준: "센터가 지시하지 않으면 아무도 이 콘텐츠를 다음으로 옮기지 않는다".
 * 세 축의 교집합으로 판정하며 셋 다 shared에서 파생한다:
 *
 *  ① 이 앱의 전용 액션이 없다 — canDecide·canRetry·canDistribute가 이미 진행 경로를 주면
 *     탈출구를 중복 노출하지 않는다(기존 설계 의도 그대로: 실패 6종은 canRetry가,
 *     awaiting_center_review는 canDecide가, center_approved는 canDistribute가 담당).
 *  ② 자기 자신이 자동 진행 상태가 아니다 — shared `isAutoProgressContentStatus`
 *     (= SYSTEM_DRIVEN ∩ 구현된 출구 보유, NOT_WIRED 파생).
 *  ③ **나가는 길 끝에 자동 진행 상태가 하나도 없다** — 출구 중 하나라도 자동 진행 상태로
 *     이어지면 그 길은 파이프라인·기자가 실제로 밟는 길이므로 센터가 대신 눌러선 안 된다.
 *
 * ③이 핵심이다. 이것만으로
 *   · `draft`(→`uploading`이 자동 진행 = 기자의 업로드 시작이 진짜 경로)
 *   · `awaiting_reporter_review`(→`reporter_approved`가 자동 진행 = 담당 기자 결정이 진짜 경로.
 *     서버도 `requireOwnerReporter`로 센터를 막는다)
 * 가 **상태 이름을 적지 않고** 닫히고,
 *   · `revision_requested` → `regenerating`은 auto_edit 미구동이라 shared가 **정지 상태**로 판정
 *     (자동 진행 아님) → 열림 (대장 #98의 유일한 진행 수단, 기존 동작 무회귀)
 *   · `published` → `archived`는 시스템 구동 후보가 아님 → 열림 (대장 #124 — 보관)
 * 만 남는다.
 *
 * 자기 갱신성: auto_edit이 구동되는 순간 `regenerating`이 자동 진행 상태가 되어
 * revision_requested의 탈출구가 **저절로 닫힌다**(사람이 되돌릴 것을 기억할 필요가 없다 —
 * EXEC-DECISIONS #29 ④와 동형).
 *
 * canDecide는 awaiting_center_review에서만 — 서버 approve/request-revision/reject가
 * 그 상태에서 requireCenterActor를 강제하고, awaiting_reporter_review는 requireOwnerReporter라
 * 기자 전용 액션은 애초에 canDecide=false로 렌더되지 않는다.
 */
export function centerActionsFor(c: Pick<Content, 'status'>): CenterActions {
  const canDecide = c.status === ContentStatus.AwaitingCenterReview;
  const canRetry = isFailureStatus(c.status);
  const canDistribute = c.status === ContentStatus.CenterApproved;
  // 상태 규칙의 원천은 shared 전이 맵(사본 금지) — regeneration_failed는 canRetry가 담당한다
  const canRegenerate =
    c.status === ContentStatus.RevisionRequested &&
    canTransitionContent(c.status, ContentStatus.Regenerating);

  const exits: readonly ContentStatus[] = CONTENT_STATUS_TRANSITIONS[c.status];
  const dedicatedActionExists = canDecide || canRetry || canDistribute || canRegenerate;
  const someoneElseDrivesIt =
    isAutoProgressContentStatus(c.status) || exits.some((to) => isAutoProgressContentStatus(to));

  const manualTransitionTargets: readonly ContentStatus[] =
    dedicatedActionExists || someoneElseDrivesIt ? [] : exits;

  return {
    canDecide,
    canRetry,
    canDistribute,
    canArchive: manualTransitionTargets.includes(ContentStatus.Archived),
    canRegenerate,
    manualTransitionTargets,
  };
}

// (이력) 舊 미성년자 동의 게이트 판정부(minorConsentGateEdge/State·minorConsentActionsFor,
// T-W2-32·대장 #130)는 확인 개념과 함께 T-W2-36으로 제거 — 앱은 동의서 수취를 판단하지 않는다.
