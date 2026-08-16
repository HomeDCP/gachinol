import { MinorConsentFilter } from '@gachinol/shared';
import {
  BOARD_VIEWS,
  DEFAULT_BOARD_EMPTY_MESSAGE,
  boardViewEmptyMessage,
  toBoardFilter,
} from '../board-views';
import { contentKeys } from '../../../query/keys';

/**
 * 대장 #118 — 센터가 "동의 확인 대기" 콘텐츠를 **발견**하는 유일한 목록 경로.
 * 이 뷰가 사라지거나 필터를 잘못 걸면 미성년자 게이트에 막힌 콘텐츠가 다시 보이지 않게 되고,
 * reviewPolicy='reporter_only'는 센터 검토를 아예 거치지 않으므로 다른 화면에서도 드러나지 않는다.
 */
describe('BOARD_VIEWS — 동의 확인 대기 뷰 (대장 #118)', () => {
  const consentView = BOARD_VIEWS.find((v) => v.minorConsent !== undefined);

  it('동의 확인 대기 뷰가 존재하고 minorConsent=pending을 건다', () => {
    expect(consentView).toBeDefined();
    expect(consentView?.minorConsent).toBe(MinorConsentFilter.Pending);
    expect(consentView?.label).toBe('동의 확인 대기');
  });

  it('status가 아니라 직교 축을 건다 — 상태 필터를 함께 걸지 않는다', () => {
    // 게이트가 막는 status는 reviewPolicy마다 다르다(reporter_only=awaiting_reporter_review).
    // status를 함께 걸면 한쪽 정책의 차단분이 통째로 사라진다.
    expect(consentView?.status).toBeUndefined();
  });

  it('가로 스크롤 없이 보이도록 앞쪽(2번째 이내)에 있다', () => {
    expect(BOARD_VIEWS.findIndex((v) => v.minorConsent !== undefined)).toBeLessThanOrEqual(1);
  });

  it('기본 진입(index 0)은 센터 검토 대기 — 기존 동작 무회귀', () => {
    expect(BOARD_VIEWS[0]?.status).toBe('awaiting_center_review');
    expect(BOARD_VIEWS[0]?.minorConsent).toBeUndefined();
  });

  it('칩 라벨 중복 없음 (key 충돌 방지)', () => {
    const labels = BOARD_VIEWS.map((v) => v.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('toBoardFilter — 뷰 + 부가 필터 → 서버 조회 파라미터', () => {
  const consentView = BOARD_VIEWS.find((v) => v.minorConsent !== undefined);

  it('동의 확인 대기 뷰 → { minorConsent: "pending" } (status 키 없음)', () => {
    expect(toBoardFilter(consentView)).toEqual({ minorConsent: 'pending' });
  });

  it('상태 뷰 → { status } (minorConsent 키 없음 — 기존 조회 무회귀)', () => {
    expect(toBoardFilter(BOARD_VIEWS[0])).toEqual({ status: 'awaiting_center_review' });
  });

  it("'전체' 뷰 + 지사·분류만 → 게이트 키가 붙지 않는다", () => {
    const all = BOARD_VIEWS.find((v) => v.label === '전체');
    expect(toBoardFilter(all, { category: 'news', stationId: 's-aewol' as never })).toEqual({
      category: 'news',
      stationId: 's-aewol',
    });
  });

  it('지사·분류 필터와 조합된다 (게이트 뷰에서도 좁혀볼 수 있다)', () => {
    expect(
      toBoardFilter(consentView, { category: 'culture', stationId: 's-aewol' as never }),
    ).toEqual({ minorConsent: 'pending', category: 'culture', stationId: 's-aewol' });
  });

  it('undefined 키를 만들지 않는다 (캐시 키 안정성)', () => {
    expect(Object.keys(toBoardFilter(undefined))).toEqual([]);
  });

  it('minorConsent가 캐시 키에 반영된다 — 게이트 뷰가 전체 뷰의 캐시를 재사용하면 안 된다', () => {
    const all = BOARD_VIEWS.find((v) => v.label === '전체');
    expect(contentKeys.list(toBoardFilter(consentView))).not.toEqual(
      contentKeys.list(toBoardFilter(all)),
    );
  });
});

describe('boardViewEmptyMessage — 0건 문구는 뷰마다 다른 사실을 말한다', () => {
  it('동의 확인 대기 뷰의 0건은 "검토할 콘텐츠가 없습니다"가 아니다', () => {
    const consentView = BOARD_VIEWS.find((v) => v.minorConsent !== undefined);
    const message = boardViewEmptyMessage(consentView);
    expect(message).not.toBe(DEFAULT_BOARD_EMPTY_MESSAGE);
    expect(message).toContain('동의');
  });

  it('문구가 없는 뷰는 기본 문구', () => {
    expect(boardViewEmptyMessage(BOARD_VIEWS[0])).toBe(DEFAULT_BOARD_EMPTY_MESSAGE);
    expect(boardViewEmptyMessage(undefined)).toBe(DEFAULT_BOARD_EMPTY_MESSAGE);
  });
});
