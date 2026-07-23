import { currentWeekOfKst, formatWeekLabel, formatWeekRange } from '../week';

/** 2026-06-01은 월요일 (서버 E2E 픽스처와 동일 기준 주차) */
const MONDAY = '2026-06-01';

describe('currentWeekOfKst — KST 월요일 내림', () => {
  test('수요일 낮 → 그 주 월요일', () => {
    // 2026-06-03T05:00Z = 06-03 14:00 KST (수)
    expect(currentWeekOfKst(new Date('2026-06-03T05:00:00.000Z'))).toBe(MONDAY);
  });

  test('월요일 당일 → 자기 자신', () => {
    expect(currentWeekOfKst(new Date('2026-06-01T09:00:00.000Z'))).toBe(MONDAY);
  });

  test('일요일 23:00 KST → 아직 그 주(월요일 = 06-01)', () => {
    // 2026-06-07T14:00Z = 06-07 23:00 KST (일)
    expect(currentWeekOfKst(new Date('2026-06-07T14:00:00.000Z'))).toBe(MONDAY);
  });

  test('월요일 00:30 KST → 다음 주로 넘어감', () => {
    // 2026-06-07T15:30Z = 06-08 00:30 KST (월)
    expect(currentWeekOfKst(new Date('2026-06-07T15:30:00.000Z'))).toBe('2026-06-08');
  });

  test('경계: 일 23:59:59 KST vs 월 00:00:00 KST', () => {
    // 2026-05-31T14:59:59Z = 05-31 23:59:59 KST (일) → 전 주
    expect(currentWeekOfKst(new Date('2026-05-31T14:59:59.000Z'))).toBe('2026-05-25');
    // 2026-05-31T15:00:00Z = 06-01 00:00 KST (월) → 새 주
    expect(currentWeekOfKst(new Date('2026-05-31T15:00:00.000Z'))).toBe(MONDAY);
  });

  test('UTC 날짜와 KST 날짜가 갈리는 시각에도 KST 기준으로 판정', () => {
    // 2026-06-07T16:00Z: UTC로는 일요일이지만 KST로는 06-08 01:00 월요일
    expect(currentWeekOfKst(new Date('2026-06-07T16:00:00.000Z'))).toBe('2026-06-08');
  });

  test('연말 → 연초 넘김', () => {
    // 2026-12-31T05:00Z = 12-31 14:00 KST (목) → 그 주 월요일 12-28
    expect(currentWeekOfKst(new Date('2026-12-31T05:00:00.000Z'))).toBe('2026-12-28');
  });

  test('윤년 2월 29일(2028) 주차', () => {
    // 2028-02-29T05:00Z = 02-29 14:00 KST (화) → 그 주 월요일 02-28
    expect(currentWeekOfKst(new Date('2028-02-29T05:00:00.000Z'))).toBe('2028-02-28');
  });

  test('반환값은 항상 월요일 — 임의 52주 순회', () => {
    const base = Date.parse('2026-01-01T03:00:00.000Z');
    for (let i = 0; i < 52 * 7; i += 1) {
      const weekOf = currentWeekOfKst(new Date(base + i * 24 * 60 * 60 * 1000));
      expect(new Date(`${weekOf}T00:00:00.000Z`).getUTCDay()).toBe(1);
    }
  });
});

describe('formatWeekRange / formatWeekLabel', () => {
  test('월~일 7일 범위', () => {
    expect(formatWeekRange(MONDAY)).toBe('6/1~6/7');
  });

  test('월 경계를 넘는 주차', () => {
    expect(formatWeekRange('2026-06-29')).toBe('6/29~7/5');
  });

  test('연 경계를 넘는 주차', () => {
    expect(formatWeekRange('2026-12-28')).toBe('12/28~1/3');
  });

  test('라벨 = 주차 + 범위', () => {
    expect(formatWeekLabel(MONDAY)).toBe('2026-06-01 주 · 6/1~6/7');
  });

  test('형식 위반 입력은 그대로 반환(화면 크래시 금지)', () => {
    expect(formatWeekLabel('abc')).toBe('abc');
    expect(formatWeekRange('2026-6-1')).toBe('2026-6-1');
    expect(formatWeekLabel('')).toBe('');
  });

  test('로컬 시간대 무관 — 오프셋 포맷이면 하루 밀린다', () => {
    // 06-01은 어떤 시간대에서 렌더해도 6/1이어야 한다
    expect(formatWeekRange('2026-01-01').startsWith('1/1~')).toBe(true);
  });
});
