import { createContext, useContext, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { StationId } from '@gachinol/shared';

/**
 * 검토 보드 stationId 딥링크 — 지사 탭에서 "이 지사 검토물 보기"를 누르면
 * stationId를 설정하고 보드 탭으로 이동한다(파생 카운트 없이 순수 딥링크).
 */
interface BoardFilterValue {
  stationId?: StationId;
  setStationId(id: StationId | undefined): void;
}

const BoardFilterContext = createContext<BoardFilterValue | null>(null);

export function BoardFilterProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [stationId, setStationId] = useState<StationId | undefined>(undefined);
  const value = useMemo(() => ({ stationId, setStationId }), [stationId]);
  return <BoardFilterContext.Provider value={value}>{children}</BoardFilterContext.Provider>;
}

export function useBoardFilter(): BoardFilterValue {
  const ctx = useContext(BoardFilterContext);
  if (!ctx) throw new Error('useBoardFilter는 BoardFilterProvider 안에서만 사용할 수 있습니다');
  return ctx;
}
