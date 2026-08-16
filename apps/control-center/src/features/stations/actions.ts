import { STATION_STATUS_TRANSITIONS } from '@gachinol/shared';
import type { StationStatus } from '@gachinol/shared';
import type { BadgeToneName } from '../../ui/theme';

/**
 * 지사 상태 액션 파생 — **규칙 사본 금지**.
 * "어떤 전이가 합법인가"는 shared `STATION_STATUS_TRANSITIONS`가 유일한 원천이고
 * (서버 `StationWorkflowService`도 같은 맵을 소비한다), 여기서는 그 합법 전이 쌍에
 * **이름·라벨·확인 문구만** 붙인다. 상태 이름을 조건문에 하드코딩하지 않는다.
 * 선례: `features/live/labels.ts`의 `availableLifecycleActions`.
 */

export const STATION_STATUS_LABEL = {
  operating: '운영 중',
  dormant: '휴무',
  planned: '설립 예정',
} as const satisfies Record<StationStatus, string>;

export const STATION_STATUS_TONE = {
  operating: 'success',
  dormant: 'neutral',
  planned: 'info',
} as const satisfies Record<StationStatus, BadgeToneName>;

export const STATION_STATUS_DESCRIPTION = {
  operating: '현장 취재·업로드가 열려 있습니다.',
  dormant: '설립됐지만 현재 휴무입니다. 부활하면 즉시 운영으로 돌아갑니다.',
  planned: '아직 설립 전입니다. 운영을 시작하면 지사로 편입됩니다.',
} as const satisfies Record<StationStatus, string>;

/** 전이 액션 3종 — (from→to) 쌍에 붙는 이름일 뿐 상태 자체가 아니다 */
export type StationTransitionAction = 'revive' | 'launch' | 'suspend';

/**
 * (from→to) → 액션 이름. **키가 전이맵의 합법 쌍과 1:1로 대응**해야 하며,
 * 그 대응은 `actions.test.ts`가 shared 맵 전수 순회로 강제한다
 * (shared에 엣지가 늘면 라벨 없는 버튼이 조용히 사라지는 대신 테스트가 깨진다).
 */
const PAIR_ACTION: Readonly<Record<string, StationTransitionAction>> = {
  /** 휴무 지사 부활 — CLAUDE.md §11 MVP(애월·제주시)의 실체 */
  'dormant->operating': 'revive',
  'planned->operating': 'launch',
  'operating->dormant': 'suspend',
};

export interface StationActionMeta {
  label: string;
  /** 운영 중단처럼 되돌리기 어려운 조작은 확인 다이얼로그를 위험 색으로 */
  destructive: boolean;
  confirmTitle: string;
  confirmMessage: string;
}

export const STATION_ACTION_META = {
  revive: {
    label: '부활',
    destructive: false,
    confirmTitle: '지사를 부활할까요?',
    confirmMessage: '휴무를 끝내고 운영 중으로 되돌립니다. 현장 취재·업로드가 다시 열립니다.',
  },
  launch: {
    label: '운영 시작',
    destructive: false,
    confirmTitle: '운영을 시작할까요?',
    confirmMessage: '설립 예정 지사를 운영 중으로 전환합니다.',
  },
  suspend: {
    label: '휴무 전환',
    destructive: true,
    confirmTitle: '휴무로 전환할까요?',
    confirmMessage: '운영을 멈추고 휴무로 전환합니다. 휴무 시작 시각이 기록됩니다.',
  },
} as const satisfies Record<StationTransitionAction, StationActionMeta>;

export interface StationTransitionOption extends StationActionMeta {
  action: StationTransitionAction;
  /** 서버 `TransitionStationRequest.toStatus`로 그대로 보낼 목적 상태 */
  toStatus: StationStatus;
}

/**
 * 현재 상태에서 가능한 전이 액션 — shared 전이맵의 합법 목적지에서만 파생한다.
 * 순서는 shared 전이 배열 순서를 따른다. 라벨이 없는 쌍은 렌더하지 않는다
 * (이름 없는 버튼을 그리느니 안 그리는 게 낫다 — 대신 위 테스트가 누락을 잡는다).
 */
export function availableStationTransitions(from: StationStatus): StationTransitionOption[] {
  const targets: readonly StationStatus[] = STATION_STATUS_TRANSITIONS[from] ?? [];
  const options: StationTransitionOption[] = [];
  for (const to of targets) {
    const action = PAIR_ACTION[`${from}->${to}`];
    if (!action) continue;
    options.push({ action, toStatus: to, ...STATION_ACTION_META[action] });
  }
  return options;
}

/** 테스트·검증용 — 라벨이 매핑된 (from→to) 쌍 전수 */
export const labeledTransitionPairs = (): readonly string[] => Object.keys(PAIR_ACTION);
