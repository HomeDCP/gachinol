/** 상태머신 전이 맵 — `Record<상태, 허용 다음상태[]>`가 유일한 진실 */
export type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

/** from → to 전이 허용 여부. `?? []`로 noUncheckedIndexedAccess·제네릭 인스턴스화에 안전 */
export const canTransition = <S extends string>(map: TransitionMap<S>, from: S, to: S): boolean =>
  ((map[from] ?? []) as readonly S[]).includes(to);

/** 현재 상태에서 갈 수 있는 다음 상태 목록 */
export const nextStates = <S extends string>(map: TransitionMap<S>, from: S): readonly S[] =>
  (map[from] ?? []) as readonly S[];

/** 종결 상태 여부 (허용 다음 상태 없음) */
export const isTerminalState = <S extends string>(map: TransitionMap<S>, s: S): boolean =>
  nextStates(map, s).length === 0;
