import { toId } from '@gachinol/shared';
import type {
  ContentId,
  ContentSummary,
  RecommendationItem,
  RecommendationReview,
  StationId,
  WeeklyRecommendation,
  WeeklyRecommendationId,
} from '@gachinol/shared';
import { ApiClientError, ApiNetworkError } from '../../../api/errors';
import {
  conflictRecommendationId,
  formatScore,
  isRegenerated,
  itemCountLabel,
  missingItemCount,
  sortedReviewItems,
} from '../selectors';

const contentId = (n: number): ContentId => toId<ContentId>(`content-${n}`);

const item = (rank: number, over: Partial<RecommendationItem> = {}): RecommendationItem => ({
  contentId: contentId(rank),
  rank,
  score: 0.9 - rank * 0.1,
  reason: `근거 ${rank}`,
  ...over,
});

const content = (n: number): ContentSummary => ({
  id: contentId(n),
  title: `콘텐츠 ${n}`,
  category: 'news',
  status: 'published',
  stationId: toId<StationId>('station-1'),
  stationName: '애월마을방송국',
  reporterId: null,
  reporterName: null,
  durationSec: 120,
  // 미성년자 동의 게이트 (T-W2-27) — 추천 항목은 이미 published라 게이트와 무관하다
  hasMinorSubject: false,
  minorConsentConfirmedAt: null,
  createdAt: '2026-06-02T00:00:00.000Z',
  publishedAt: '2026-06-02T01:00:00.000Z',
});

const recommendation = (
  items: readonly RecommendationItem[],
  over: Partial<WeeklyRecommendation> = {},
): WeeklyRecommendation => ({
  id: toId<WeeklyRecommendationId>('rec-1'),
  weekOf: '2026-06-01',
  status: 'pending_review',
  generation: 1,
  summary: '2026-06-01 주간 — 후보 7건 중 상위 3건 선정.',
  items,
  generatedByJobId: null,
  approvedByUserId: null,
  approvedAt: null,
  publishedAt: null,
  createdAt: '2026-06-08T00:00:00.000Z',
  updatedAt: '2026-06-08T00:00:01.000Z',
  ...over,
});

const review = (
  items: readonly RecommendationItem[],
  joined: readonly RecommendationItem[] = items,
): RecommendationReview => ({
  recommendation: recommendation(items),
  items: joined.map((i) => ({ item: i, content: content(i.rank) })),
});

describe('sortedReviewItems — rank 오름차순', () => {
  test('뒤섞인 순서를 rank로 재정렬', () => {
    const r = review([item(3), item(1), item(2)]);
    expect(sortedReviewItems(r).map((x) => x.item.rank)).toEqual([1, 2, 3]);
  });

  test('원본 배열을 변형하지 않는다', () => {
    const r = review([item(2), item(1)]);
    sortedReviewItems(r);
    expect(r.items.map((x) => x.item.rank)).toEqual([2, 1]);
  });

  test('빈 items → 빈 배열', () => {
    expect(sortedReviewItems(review([]))).toEqual([]);
  });
});

describe('formatScore — 점수 부재와 0.00 구분', () => {
  test('undefined → —', () => {
    expect(formatScore(undefined)).toBe('—');
  });

  test('0 → 0.00 (부재로 뭉개지 않는다)', () => {
    expect(formatScore(0)).toBe('0.00');
  });

  test('소수 2자리 반올림', () => {
    expect(formatScore(0.9)).toBe('0.90');
    expect(formatScore(0.8249)).toBe('0.82');
    expect(formatScore(1)).toBe('1.00');
  });

  test('NaN·Infinity → —', () => {
    expect(formatScore(Number.NaN)).toBe('—');
    expect(formatScore(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('missingItemCount / itemCountLabel — 조인 누락 정직 표기', () => {
  test('전량 조인되면 0건 누락', () => {
    const r = review([item(1), item(2)]);
    expect(missingItemCount(r)).toBe(0);
    expect(itemCountLabel(r)).toBe('2건');
  });

  test('콘텐츠가 삭제되어 조인에서 빠지면 누락 카운트', () => {
    const items = [item(1), item(2), item(3)];
    const r = review(items, [items[0]!, items[2]!]);
    expect(missingItemCount(r)).toBe(1);
    expect(itemCountLabel(r)).toBe('3건 중 2건 표시');
  });

  test('음수로 내려가지 않는다 (방어)', () => {
    const r: RecommendationReview = {
      recommendation: recommendation([]),
      items: [{ item: item(1), content: content(1) }],
    };
    expect(missingItemCount(r)).toBe(0);
  });

  test('빈 추천 → 0건', () => {
    expect(itemCountLabel(review([]))).toBe('0건');
  });
});

describe('isRegenerated — generation ≥ 2', () => {
  test('v1은 false, v2 이상은 true', () => {
    expect(isRegenerated({ generation: 1 })).toBe(false);
    expect(isRegenerated({ generation: 2 })).toBe(true);
    expect(isRegenerated({ generation: 5 })).toBe(true);
  });
});

describe('conflictRecommendationId — 409 details.id 추출', () => {
  test('409 + details.id → 브랜디드 id', () => {
    const err = new ApiClientError(409, {
      code: 'conflict',
      message: '해당 주차 추천이 이미 있습니다',
      details: { id: 'rec-42', status: 'approved' },
    });
    expect(conflictRecommendationId(err)).toBe('rec-42');
  });

  test('409지만 details 없음(경합 분기) → null', () => {
    const err = new ApiClientError(409, {
      code: 'conflict',
      message: '해당 주차 추천이 방금 생성되었습니다 — 재조회하세요',
    });
    expect(conflictRecommendationId(err)).toBeNull();
  });

  test('409가 아닌 ApiClientError → null', () => {
    const err = new ApiClientError(403, {
      code: 'forbidden',
      message: '권한이 없습니다',
      details: { id: 'rec-42' },
    });
    expect(conflictRecommendationId(err)).toBeNull();
  });

  test('details.id가 문자열이 아니거나 비어있으면 null', () => {
    for (const details of [{ id: 123 }, { id: '' }, { status: 'approved' }]) {
      const err = new ApiClientError(409, { code: 'conflict', message: 'x', details });
      expect(conflictRecommendationId(err)).toBeNull();
    }
  });

  test('네트워크 에러·비에러 값 → null', () => {
    expect(conflictRecommendationId(new ApiNetworkError())).toBeNull();
    expect(conflictRecommendationId(undefined)).toBeNull();
    expect(conflictRecommendationId({ status: 409 })).toBeNull();
  });
});
