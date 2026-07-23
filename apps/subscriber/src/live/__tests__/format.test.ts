import { LiveSessionStatus } from '@gachinol/shared';
import { formatChatTime, formatViewerCount, isOnAir, LIVE_STATUS_LABEL } from '../format';

describe('live format', () => {
  test('LIVE_STATUS_LABEL: 6종 전수 라벨', () => {
    for (const s of Object.values(LiveSessionStatus)) {
      expect(typeof LIVE_STATUS_LABEL[s]).toBe('string');
    }
  });

  test('isOnAir: live만 true', () => {
    expect(isOnAir('live')).toBe(true);
    for (const s of ['scheduled', 'preparing', 'interrupted', 'ended', 'canceled'] as const) {
      expect(isOnAir(s)).toBe(false);
    }
  });

  test('formatViewerCount: 음수/NaN 방어 + 천단위', () => {
    expect(formatViewerCount(0)).toBe('0명');
    expect(formatViewerCount(-5)).toBe('0명');
    expect(formatViewerCount(Number.NaN)).toBe('0명');
    expect(formatViewerCount(1234)).toBe('1,234명');
  });

  test('formatChatTime: HH:MM, 파싱 실패는 빈 문자열', () => {
    expect(formatChatTime('not-a-date')).toBe('');
    // 로컬 타임존 의존 없이 형식만 검증(HH:MM)
    expect(formatChatTime('2026-07-23T09:05:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });
});
