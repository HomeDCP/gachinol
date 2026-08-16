import { STATION_STATUS_TRANSITIONS, StationStatus } from '@gachinol/shared';
import {
  STATION_ACTION_META,
  STATION_STATUS_DESCRIPTION,
  STATION_STATUS_LABEL,
  STATION_STATUS_TONE,
  availableStationTransitions,
  labeledTransitionPairs,
} from '../actions';

describe('availableStationTransitions — shared 전이맵에서만 파생', () => {
  it('dormant(휴무)에서는 operating으로 가는 "부활"이 제공된다 — MVP 애월·제주시 부활', () => {
    const options = availableStationTransitions('dormant');
    const revive = options.find((o) => o.action === 'revive');

    expect(revive).toBeDefined();
    expect(revive?.toStatus).toBe('operating');
    expect(revive?.destructive).toBe(false);
    expect(revive?.label).toBe('부활');
  });

  it('planned(설립 예정)에서는 operating으로 가는 "운영 시작"만 제공된다', () => {
    const options = availableStationTransitions('planned');
    expect(options.map((o) => o.action)).toEqual(['launch']);
    expect(options.map((o) => o.toStatus)).toEqual(['operating']);
  });

  it('operating(운영 중)에서는 dormant로 가는 "휴무 전환"이 위험 액션으로 제공된다', () => {
    const options = availableStationTransitions('operating');
    expect(options.map((o) => o.action)).toEqual(['suspend']);
    expect(options.map((o) => o.toStatus)).toEqual(['dormant']);
    expect(options.map((o) => o.destructive)).toEqual([true]);
  });

  it('제공되는 목적 상태는 항상 shared 전이맵의 합법 목적지 부분집합이다', () => {
    for (const from of Object.values(StationStatus)) {
      const legal = STATION_STATUS_TRANSITIONS[from] as readonly StationStatus[];
      for (const option of availableStationTransitions(from)) {
        expect(legal).toContain(option.toStatus);
      }
    }
  });

  /**
   * 회귀 방어: shared에 전이 엣지가 늘었는데 라벨을 안 붙이면 화면에서 그 액션이 **조용히 사라진다**.
   * 사라진 버튼은 아무도 신고하지 않으므로 여기서 깨뜨린다.
   */
  it('shared 전이맵의 모든 합법 엣지에 액션 라벨이 매핑돼 있다', () => {
    const labeled = new Set(labeledTransitionPairs());
    const missing: string[] = [];
    for (const from of Object.values(StationStatus)) {
      for (const to of STATION_STATUS_TRANSITIONS[from] as readonly StationStatus[]) {
        if (!labeled.has(`${from}->${to}`)) missing.push(`${from}->${to}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('라벨이 붙은 쌍은 전부 shared 전이맵에도 존재한다 (죽은 액션 금지)', () => {
    for (const pair of labeledTransitionPairs()) {
      const [from, to] = pair.split('->') as [StationStatus, StationStatus];
      expect(STATION_STATUS_TRANSITIONS[from] as readonly StationStatus[]).toContain(to);
    }
  });
});

describe('상태 표기 — 3종 전수', () => {
  it.each(Object.values(StationStatus))('%s 상태에 라벨·톤·설명이 모두 있다', (status) => {
    expect(STATION_STATUS_LABEL[status]).toBeTruthy();
    expect(STATION_STATUS_TONE[status]).toBeTruthy();
    expect(STATION_STATUS_DESCRIPTION[status]).toBeTruthy();
  });
});

describe('액션 메타 — 확인 다이얼로그 문구', () => {
  it('모든 액션이 확인 제목·본문을 갖는다 (되돌리기 어려운 운영 조작이라 확인 필수)', () => {
    for (const meta of Object.values(STATION_ACTION_META)) {
      expect(meta.confirmTitle).toBeTruthy();
      expect(meta.confirmMessage).toBeTruthy();
    }
  });
});
