import type { ContentStatus, ProgramCategory, StationId } from '@gachinol/shared';
import type { BoardFilter } from '../../query/keys';

/**
 * 검토 보드의 뷰(칩) 정의 — 화면이 아니라 여기 두는 이유: "무엇을 조회하는가"는 순수 매핑이라
 * 라우트 모듈을 렌더하지 않고 테스트할 수 있어야 한다(대장 #118의 발견 수단이 조용히 끊기면
 * 게이트에 막힌 콘텐츠가 다시 안 보이게 된다).
 *
 * 서버 `status`는 단일 값만 받는다(status-set/IN 미지원) → 단일 선택.
 * 기본 진입(index 0)은 '센터 검토 대기'로 노이즈(전 지사·draft·live_vod 포함)를 억제한다.
 */
export interface BoardView {
  readonly label: string;
  readonly status?: ContentStatus;
  /** 결과 0건일 때의 문구 — 뷰마다 "없다"의 의미가 다르다(미지정 시 기본 문구) */
  readonly emptyMessage?: string;
}

// (이력) 舊 '동의 확인 대기' 뷰(T-W2-27, 대장 #118)는 T-W2-36으로 제거 — 판단 축 자체가 소멸.
export const BOARD_VIEWS: readonly BoardView[] = [
  { label: '검토 대기', status: 'awaiting_center_review' },
  { label: '전체' },
  { label: '처리 중', status: 'processing' },
  { label: '분석 중', status: 'analyzing' },
  { label: '프리뷰 생성', status: 'preview_generating' },
  { label: '기자 확인 대기', status: 'awaiting_reporter_review' },
  { label: '편집 실패', status: 'processing_failed' },
  { label: '송출 실패', status: 'publish_failed' },
  { label: '송출 완료', status: 'published' },
];

/**
 * 선택된 뷰 + 부가 필터(지사·분류) → 서버 조회 필터.
 * undefined 키를 만들지 않는다 — `contentKeys.list()` 정규화와 같은 규약(키 안정성).
 */
export const toBoardFilter = (
  view: BoardView | undefined,
  extra: { category?: ProgramCategory; stationId?: StationId } = {},
): BoardFilter => ({
  ...(view?.status ? { status: view.status } : {}),
  ...(extra.category ? { category: extra.category } : {}),
  ...(extra.stationId ? { stationId: extra.stationId } : {}),
});

/** 0건 문구 — "검토할 게 없다"와 "동의 확인 대기가 없다"는 다른 사실이다 */
export const DEFAULT_BOARD_EMPTY_MESSAGE = '검토할 콘텐츠가 없습니다';

export const boardViewEmptyMessage = (view: BoardView | undefined): string =>
  view?.emptyMessage ?? DEFAULT_BOARD_EMPTY_MESSAGE;
