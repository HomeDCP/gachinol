import {
  isDateOnly,
  KST_OFFSET_MS,
  mondayOfWeekKst,
  parseDateOnly,
  toDateOnly,
  weekWindowUtc,
} from './week';

describe('week — 주차(weekOf) 순수 계산', () => {
  it('주중 아무 날짜나 그 주 월요일로 내림 (2026-06-01이 월요일)', () => {
    expect(mondayOfWeekKst('2026-06-01')).toBe('2026-06-01'); // 월
    expect(mondayOfWeekKst('2026-06-03')).toBe('2026-06-01'); // 수
    expect(mondayOfWeekKst('2026-06-07')).toBe('2026-06-01'); // 일 — 그 주에 속한다
    expect(mondayOfWeekKst('2026-06-08')).toBe('2026-06-08'); // 다음 주 월
  });

  it('토요일은 전 주 월요일로 (주차 경계)', () => {
    expect(mondayOfWeekKst('2026-05-30')).toBe('2026-05-25');
  });

  it('월 경계를 넘는 주차도 정확', () => {
    expect(mondayOfWeekKst('2026-01-01')).toBe('2025-12-29'); // 목요일
  });

  it('윈도우는 [월 00:00 KST, +7d) = UTC 전일 15:00Z 반개구간', () => {
    const { start, end } = weekWindowUtc('2026-06-01');
    expect(start.toISOString()).toBe('2026-05-31T15:00:00.000Z');
    expect(end.toISOString()).toBe('2026-06-07T15:00:00.000Z');
    expect(end.getTime() - start.getTime()).toBe(7 * 24 * 3600 * 1000);
  });

  it('KST 오프셋은 +9h 고정 (DST 없음)', () => {
    expect(KST_OFFSET_MS).toBe(9 * 3600 * 1000);
  });

  it('toDateOnly는 UTC 기반 — 서버 TZ와 무관하게 같은 날짜', () => {
    expect(toDateOnly(new Date('2026-06-01T00:00:00.000Z'))).toBe('2026-06-01');
    expect(toDateOnly(new Date('2026-06-01T23:59:59.999Z'))).toBe('2026-06-01');
  });

  it('형식·존재하지 않는 날짜는 거부', () => {
    expect(() => parseDateOnly('2026-6-1')).toThrow();
    expect(() => parseDateOnly('20260601')).toThrow();
    expect(() => parseDateOnly('2026-02-31')).toThrow();
  });

  it('isDateOnly는 parseDateOnly와 같은 판정(스키마 refine 술어)', () => {
    expect(isDateOnly('2026-06-01')).toBe(true);
    expect(isDateOnly('2024-02-29')).toBe(true); // 윤년
    expect(isDateOnly('2026-02-31')).toBe(false);
    expect(isDateOnly('2026-13-45')).toBe(false);
    expect(isDateOnly('2026-6-1')).toBe(false);
  });

  it('멱등: 정규화 결과를 다시 정규화해도 같다', () => {
    const once = mondayOfWeekKst('2026-06-04');
    expect(mondayOfWeekKst(once)).toBe(once);
  });
});
