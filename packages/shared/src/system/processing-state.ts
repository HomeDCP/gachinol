/**
 * 미디어 처리 게이트 상태 — `GET /v1/system/processing-state` 응답 계약.
 *
 * 백엔드를 DCP 파이프라인과 같은 호스트에서 돌릴 때(제온 임시 백엔드), DCP가 CPU를 쓰는 동안
 * 미디어 큐가 정지한다. 기자·센터 앱이 "업로드는 됐는데 왜 처리가 안 시작되지?"에 답하기 위한 표면이다.
 *
 * 게이트가 비활성인 환경(로컬·클라우드 단독 배포)에서는 `enabled=false`로 상시 처리 가능이다.
 */

/** 큐를 정지시킨 사유. holding=false면 null */
export const ProcessingHoldReason = {
  /** DCP가 CPU를 쓰는 작업 중 */
  DcpBusy: 'dcp_busy',
  /** DCP에 대기 작업이 있어 곧 시작됨 */
  DcpImminent: 'dcp_imminent',
  /** DCP 상태를 확인할 수 없음(보수적 정지) */
  DcpUnreachable: 'dcp_unreachable',
} as const;
export type ProcessingHoldReason =
  (typeof ProcessingHoldReason)[keyof typeof ProcessingHoldReason];

/**
 * DCP 파이프라인 현황 — 표시용 투영(그쪽 내부 상태를 그대로 노출하지 않는다).
 * 판정에 쓰지 말 것: 정지 여부의 유일한 근거는 `ProcessingState.holding`이다.
 */
export interface ProcessingDcpState {
  readonly busy: boolean;
  /** 진행 단계명(표시용). 활성 작업이 없으면 null */
  readonly stage: string | null;
  /** 대기 중인 DCP 작업 수 */
  readonly queued: number;
  /** 현재 상태 시작 시각(ISO) */
  readonly since: string | null;
}

export interface ProcessingState {
  /** 게이트 활성 여부. false면 상시 처리 가능(holding은 항상 false) */
  readonly enabled: boolean;
  /** 미디어 큐가 정지 중인가 — 앱이 신뢰할 유일한 술어 */
  readonly holding: boolean;
  readonly reason: ProcessingHoldReason | null;
  /** 사용자에게 그대로 보여줄 수 있는 한국어 안내 */
  readonly message: string;
  readonly dcp: ProcessingDcpState | null;
  readonly lastCheckedAt: string | null;
}
