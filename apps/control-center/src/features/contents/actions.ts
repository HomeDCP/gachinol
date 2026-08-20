import type { Content, MinorConsentFacts, StatusTransitionLog } from '@gachinol/shared';
import {
  CONTENT_STATUS_TRANSITIONS,
  ContentStatus,
  ReviewPolicy,
  afterReporterApproval,
  canTransitionContent,
  isAutoProgressContentStatus,
  isFailureStatus,
  isMinorConsentPending,
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

// ── 미성년자 동의 게이트 (대장 #130 — #118 교착의 나머지 절반) ──────────────────

/** 전이 엣지 1건 — 게이트 판정의 표기 단위 */
export interface ContentTransitionEdge {
  readonly from: ContentStatus;
  readonly to: ContentStatus;
}

/**
 * ★ 미성년자 동의 게이트가 **실제로 지키는 전이 엣지** — 서버 `withdrawMinorConsent()`가 철회 거부
 * 판정에 쓰는 것과 같은 엣지다(services/api/src/contents/contents.service.ts).
 *
 * 분기 조건을 상태 이름이 아니라 shared `afterReporterApproval(policy)`에서 파생한다:
 * 기자 승인이 곧바로 송출로 자동 연쇄하는 정책(= 다음 상태가 `publishing`)에서는 기자 종단 승인이
 * 실질적 "승인"(더 이상의 인간 검토 없이 송출 확정)이고, 그렇지 않으면 센터 승인이 "승인"이다 —
 * `content-workflow.service.ts` policyGuard ④가 밝힌 논리 그대로다.
 * reviewPolicy가 늘어나도 이 함수는 `afterReporterApproval`의 답만 보므로 갈라지지 않는다.
 */
export const minorConsentGateEdge = (policy: ReviewPolicy): ContentTransitionEdge =>
  afterReporterApproval(policy) === ContentStatus.Publishing
    ? { from: ContentStatus.AwaitingReporterReview, to: ContentStatus.ReporterApproved }
    : { from: ContentStatus.AwaitingCenterReview, to: ContentStatus.CenterApproved };

/**
 * 게이트 통과 여부 3치. `unknown`이 별도로 있는 이유는 아래 `minorConsentGateState` 주석 참조.
 */
export type MinorConsentGateState = 'passed' | 'not_passed' | 'unknown';

/** 게이트 판정에 필요한 이력 최소 형태 — 화면의 무한스크롤 페이지를 평탄화해 넘긴다 */
export interface TransitionHistory {
  readonly logs: readonly Pick<StatusTransitionLog, 'fromStatus' | 'toStatus'>[];
  /** 이력을 **끝까지** 불러왔는가 (다음 페이지 없음). false면 판정 보류 */
  readonly complete: boolean;
}

/**
 * ★ 게이트 통과 판정 — 서버와 **같은 원천**(`status_transition_logs` 실측)에서 파생한다.
 *
 * `approvedAt`을 쓰지 않는다: reporter_then_center의 **기자 승인 hop에서도** 채워지므로
 * 게이트 통과의 프록시가 아니다(서버 D5 정정, T-W2-23). 그 필드로 판정하면
 * `awaiting_center_review`에 멈춘 콘텐츠(아직 게이트 미통과)의 철회를 잘못 막는다.
 *
 * 이력을 끝까지 못 봤으면 `'unknown'` — 못 본 페이지에 게이트 전이가 있을 수 있으므로
 * "미통과"로 단정하지 않는다(fail-closed: 호출부가 철회 버튼을 숨긴다).
 * "미통과"로 단정하면 서버가 409로 거절하는 버튼을 그리게 된다(Wave 8a에서 실제로 저지른 결함).
 */
export function minorConsentGateState(
  content: Pick<Content, 'reviewPolicy'>,
  history: TransitionHistory,
): MinorConsentGateState {
  const edge = minorConsentGateEdge(content.reviewPolicy);
  const passed = history.logs.some((l) => l.fromStatus === edge.from && l.toStatus === edge.to);
  if (passed) return 'passed';
  return history.complete ? 'not_passed' : 'unknown';
}

export interface MinorConsentActions {
  /** 이 콘텐츠가 이 축과 관계 있는가 — false면 카드 자체를 렌더하지 않는다 */
  applicable: boolean;
  /** 확인 버튼 노출 — 서버 `POST /contents/:id/minor-consent`는 hasMinorSubject=false를 거부한다 */
  canConfirm: boolean;
  /** 철회 버튼 노출 — 확인됨 ∧ 게이트 미통과가 **확정**된 경우만 */
  canWithdraw: boolean;
  /** 확인은 됐는데 철회 버튼을 감춘 이유 (안내 문구 분기용) */
  withdrawBlockedBy?: 'gate_passed' | 'history_incomplete';
  /** 판정에 쓰인 게이트 상태 (표시·테스트용) */
  gate: MinorConsentGateState;
  /** 판정에 쓰인 게이트 엣지 (표시·테스트용) */
  gateEdge: ContentTransitionEdge;
}

/**
 * ★ 동의 확인/철회 액션 파생 (T-W2-32, 대장 #130).
 *
 * "대기인가"의 판정은 shared `isMinorConsentPending` **하나뿐**이다 — api 승인 가드(policyGuard ④)·
 * 목록 필터·보드 배지가 모두 같은 술어를 쓰므로 서버가 막는 조건과 화면이 여는 버튼이 갈릴 수 없다.
 * 여기에 사본 조건(`minorConsentConfirmedAt === null` 직접 비교 등)을 쓰지 말 것.
 *
 * 철회는 서버가 **두 조건**으로 거부한다: ① 미확인(409) ② 게이트 전이가 이미 로그에 있음(409).
 * ①은 `canWithdraw`가 확인 여부를 요구해 자연히 막히고, ②는 `minorConsentGateState`가 미리 판정해
 * 버튼 자체를 그리지 않는다 — "눌러도 거절되는 버튼"을 만들지 않기 위한 것이다.
 */
export function minorConsentActionsFor(
  content: Pick<Content, 'reviewPolicy'> & MinorConsentFacts,
  history: TransitionHistory,
): MinorConsentActions {
  const gateEdge = minorConsentGateEdge(content.reviewPolicy);
  const gate = minorConsentGateState(content, history);
  const applicable = content.hasMinorSubject;
  const pending = isMinorConsentPending(content);
  const confirmed = applicable && !pending;

  const withdrawBlockedBy: MinorConsentActions['withdrawBlockedBy'] = !confirmed
    ? undefined
    : gate === 'passed'
      ? 'gate_passed'
      : gate === 'unknown'
        ? 'history_incomplete'
        : undefined;

  return {
    applicable,
    canConfirm: applicable && pending,
    canWithdraw: confirmed && gate === 'not_passed',
    ...(withdrawBlockedBy ? { withdrawBlockedBy } : {}),
    gate,
    gateEdge,
  };
}
