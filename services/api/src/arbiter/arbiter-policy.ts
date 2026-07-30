import type { ProcessingDcpState, ProcessingHoldReason } from '@gachinol/shared';

/**
 * DCP 아비터 정책 — 순수 함수(부수효과·IO 없음).
 *
 * 제온 호스트를 DCP 파이프라인과 공유하므로, DCP가 CPU를 쓰는 동안 미디어 큐를 멈춘다.
 * 계약 원천은 DCP 측 `GET /api/arbiter/state` (DSGN-API §2.1, 외부 조회 계약):
 *   { busy: boolean, stage: string|null, queued: number, since: string|null }
 *
 * **`busy`가 유일한 권위 술어다.** DCP의 상태머신(WORKING 7종 분류)은 그쪽이 소유하며
 * 우리는 재구현하지 않는다 — 그래야 그쪽이 처리 단계를 추가해도 우리가 조용히 깨지지 않는다.
 */

/**
 * DCP 측 계약 응답(우리가 소비하는 필드만). 모르는 필드는 무시한다(계약은 필드 추가만 보장).
 * 앱에 노출하는 투영(shared `ProcessingDcpState`)과 같은 모양이어야 한다 — satisfies로 강제.
 */
export type DcpArbiterState = ProcessingDcpState;

/** 큐를 멈추는 이유 — null이면 진행 가능. 값은 shared 계약이 원천(사본 금지) */
export type HoldReason = ProcessingHoldReason;

export interface HoldDecision {
  readonly hold: boolean;
  readonly reason: HoldReason | null;
}

export interface HoldPolicy {
  /** 활성 잡이 없는데 대기 잡이 있으면(디스패처가 곧 집어감) 미리 양보할지. 기본 true */
  readonly holdOnImminent: boolean;
  /** DCP api 조회 실패 시 'hold'(보수적) | 'run'(가용성 우선). 기본 'hold' */
  readonly failMode: 'hold' | 'run';
}

export const DEFAULT_HOLD_POLICY: HoldPolicy = {
  holdOnImminent: true,
  failMode: 'hold',
};

const RUN: HoldDecision = { hold: false, reason: null };

/**
 * 상태 → 정지 여부.
 *
 * `state`가 null이면 조회 실패(도달 불가·파싱 실패)를 뜻하며 `failMode`가 결정한다.
 *
 * imminent 판정에 `stage === null`("활성 잡 없음")을 쓰는 것이 `stage`를 해석하는 유일한 지점이다.
 * busy를 stage로 유추하는 것이 아니라(계약이 금지), **활성 잡의 존재 여부**만 읽는다.
 * 이 구분이 중요한 이유:
 *   - `stage=null`  + queued>0 → 디스패처가 곧 다음 잡을 집는다(초 단위) → 양보해야 한다.
 *   - `stage='review_pending'` + queued>0 → 사람 개입 대기라 큐가 **시간 단위로 안 움직인다**.
 *     여기서 양보하면 운영자가 검수를 미루는 동안 우리 파이프라인이 영구 정지한다.
 * 계약이 바뀌어 이 가정이 깨져도 최악은 "약간 보수적" 또는 "약간 경합"이며,
 * 권위 술어인 `busy` 판정은 영향받지 않는다. 불안하면 holdOnImminent=false로 끈다.
 */
export function decideHold(
  state: DcpArbiterState | null,
  policy: HoldPolicy = DEFAULT_HOLD_POLICY,
): HoldDecision {
  if (state === null) {
    return policy.failMode === 'hold'
      ? { hold: true, reason: 'dcp_unreachable' }
      : RUN;
  }
  if (state.busy) return { hold: true, reason: 'dcp_busy' };
  if (policy.holdOnImminent && state.stage === null && state.queued > 0) {
    return { hold: true, reason: 'dcp_imminent' };
  }
  return RUN;
}

/** 응답 본문 → 계약 파싱. 계약 위반(필드 누락·타입 불일치) 시 null = 조회 실패로 취급. */
export function parseArbiterState(body: unknown): DcpArbiterState | null {
  if (typeof body !== 'object' || body === null) return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.busy !== 'boolean') return null;
  const stage = raw.stage;
  if (stage !== null && typeof stage !== 'string') return null;
  const since = raw.since;
  if (since !== null && since !== undefined && typeof since !== 'string') return null;
  // queued는 계약상 존재하나, 없더라도 busy 판정은 가능하므로 0으로 저하한다(과도한 실패 회피).
  const queued = typeof raw.queued === 'number' && Number.isFinite(raw.queued) ? raw.queued : 0;
  return { busy: raw.busy, stage, queued, since: typeof since === 'string' ? since : null };
}

/** 사람이 읽을 한국어 사유 — 앱 안내 문구용(판정에는 쓰지 않는다) */
export function describeHold(reason: HoldReason | null, state: DcpArbiterState | null): string {
  switch (reason) {
    case 'dcp_busy':
      return `DCP 인코딩 작업 중(${state?.stage ?? '진행 중'}) — 완료되면 자동으로 시작됩니다`;
    case 'dcp_imminent':
      return `DCP 대기 작업 ${state?.queued ?? 0}건이 곧 시작됩니다 — 완료되면 자동으로 시작됩니다`;
    case 'dcp_unreachable':
      return 'DCP 파이프라인 상태를 확인할 수 없어 대기 중입니다';
    default:
      return '처리 가능';
  }
}
