import {
  BOARD_VIEWS,
  DEFAULT_BOARD_EMPTY_MESSAGE,
  boardViewEmptyMessage,
  toBoardFilter,
} from '../board-views';
import { contentKeys } from '../../../query/keys';

/**
 * (이력) 舊 '동의 확인 대기' 뷰(대장 #118)와 minorConsent 축은 T-W2-36으로 제거됐다 —
 * 앱은 동의서 수취를 판단하지 않는다(촬영자 책임 모델). 그 부재는
 * consent-judgment-removal.test.ts가 고정한다.
 */
describe('BOARD_VIEWS — 기본 구성', () => {
  it('기본 진입(index 0)은 센터 검토 대기 — 기존 동작 무회귀', () => {
    expect(BOARD_VIEWS[0]?.status).toBe('awaiting_center_review');
  });

  it('칩 라벨 중복 없음 (key 충돌 방지)', () => {
    const labels = BOARD_VIEWS.map((v) => v.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('toBoardFilter — 뷰 + 부가 필터 → 서버 조회 파라미터', () => {
  it('상태 뷰 → { status }', () => {
    expect(toBoardFilter(BOARD_VIEWS[0])).toEqual({ status: 'awaiting_center_review' });
  });

  it("'전체' 뷰 + 지사·분류만 → 그 두 키만 붙는다", () => {
    const all = BOARD_VIEWS.find((v) => v.label === '전체');
    expect(toBoardFilter(all, { category: 'news', stationId: 's-aewol' as never })).toEqual({
      category: 'news',
      stationId: 's-aewol',
    });
  });

  it('undefined 키를 만들지 않는다 (캐시 키 안정성)', () => {
    expect(Object.keys(toBoardFilter(undefined))).toEqual([]);
  });

  it('상태 뷰와 전체 뷰는 캐시 키가 다르다', () => {
    const all = BOARD_VIEWS.find((v) => v.label === '전체');
    expect(contentKeys.list(toBoardFilter(BOARD_VIEWS[0]))).not.toEqual(
      contentKeys.list(toBoardFilter(all)),
    );
  });
});

describe('boardViewEmptyMessage — 0건 문구', () => {
  it('문구가 없는 뷰는 기본 문구', () => {
    expect(boardViewEmptyMessage(BOARD_VIEWS[0])).toBe(DEFAULT_BOARD_EMPTY_MESSAGE);
    expect(boardViewEmptyMessage(undefined)).toBe(DEFAULT_BOARD_EMPTY_MESSAGE);
  });
});
