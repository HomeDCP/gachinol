import { createContext, useContext, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { StationId } from '@gachinol/shared';

/**
 * 피드 stationId 딥링크 — 지사 탭에서 "이 지사 보기"를 누르면 stationId를 설정하고
 * 피드 탭으로 이동한다(파생 카운트 없이 순수 크로스탭 딥링크). category는 피드 화면 로컬 state.
 */
interface FeedFilterValue {
  stationId?: StationId;
  setStationId(id: StationId | undefined): void;
}

const FeedFilterContext = createContext<FeedFilterValue | null>(null);

export function FeedFilterProvider({ children }: PropsWithChildren): React.JSX.Element {
  const [stationId, setStationId] = useState<StationId | undefined>(undefined);
  const value = useMemo(() => ({ stationId, setStationId }), [stationId]);
  return <FeedFilterContext.Provider value={value}>{children}</FeedFilterContext.Provider>;
}

export function useFeedFilter(): FeedFilterValue {
  const ctx = useContext(FeedFilterContext);
  if (!ctx) throw new Error('useFeedFilter는 FeedFilterProvider 안에서만 사용할 수 있습니다');
  return ctx;
}
