import { formatDuration, formatRelativeTime } from '../format';

describe('formatDuration', () => {
  test('0 → 0:00', () => expect(formatDuration(0)).toBe('0:00'));
  test('92 → 1:32', () => expect(formatDuration(92)).toBe('1:32'));
  test('3661 → 61:01', () => expect(formatDuration(3661)).toBe('61:01'));
  test('음수·NaN 방어', () => {
    expect(formatDuration(-5)).toBe('0:00');
    expect(formatDuration(Number.NaN)).toBe('0:00');
  });
  test('소수 floor', () => expect(formatDuration(59.9)).toBe('0:59'));
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-22T12:00:00.000Z');
  test('1분 미만 → 방금 전', () => {
    expect(formatRelativeTime('2026-07-22T11:59:30.000Z', now)).toBe('방금 전');
  });
  test('분 단위', () => {
    expect(formatRelativeTime('2026-07-22T11:30:00.000Z', now)).toBe('30분 전');
  });
  test('시간 단위', () => {
    expect(formatRelativeTime('2026-07-22T09:00:00.000Z', now)).toBe('3시간 전');
  });
  test('일 단위', () => {
    expect(formatRelativeTime('2026-07-20T12:00:00.000Z', now)).toBe('2일 전');
  });
  test('7일 이상 → 절대 날짜', () => {
    expect(formatRelativeTime('2026-07-01T12:00:00.000Z', now)).toBe('2026.07.01');
  });
  test('파싱 실패 → 입력 그대로', () => {
    expect(formatRelativeTime('not-a-date', now)).toBe('not-a-date');
  });
});
