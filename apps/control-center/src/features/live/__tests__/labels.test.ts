import { LIVE_SESSION_STATUS_TRANSITIONS, LiveSessionStatus, Platform } from '@gachinol/shared';
import {
  availableLifecycleActions,
  LIFECYCLE_ACTION_META,
  LIVE_STATUS_LABEL,
  LIVE_STATUS_TONE,
  PLATFORM_LABEL,
} from '../labels';

describe('live labels', () => {
  test('LIVE_STATUS_LABEL·TONE: 6종 전수', () => {
    for (const s of Object.values(LiveSessionStatus)) {
      expect(typeof LIVE_STATUS_LABEL[s]).toBe('string');
      expect(typeof LIVE_STATUS_TONE[s]).toBe('string');
    }
  });

  test('PLATFORM_LABEL: 7종 전수', () => {
    for (const p of Object.values(Platform)) {
      expect(typeof PLATFORM_LABEL[p]).toBe('string');
    }
  });

  test('availableLifecycleActions: 상태별 정확 매핑', () => {
    expect(availableLifecycleActions('scheduled')).toEqual(['prepare', 'cancel']);
    expect(availableLifecycleActions('preparing')).toEqual(['start', 'cancel']);
    expect(availableLifecycleActions('live')).toEqual(['interrupt', 'end']);
    expect(availableLifecycleActions('interrupted')).toEqual(['resume', 'end']);
    expect(availableLifecycleActions('ended')).toEqual([]);
    expect(availableLifecycleActions('canceled')).toEqual([]);
  });

  test('availableLifecycleActions: 개수는 shared 전이 맵의 합법 목적지 수와 일치(사본 아님)', () => {
    for (const status of Object.values(LiveSessionStatus)) {
      const legalTargets = LIVE_SESSION_STATUS_TRANSITIONS[status];
      expect(availableLifecycleActions(status)).toHaveLength(legalTargets.length);
    }
  });

  test('LIFECYCLE_ACTION_META: 종결·중단 액션은 destructive', () => {
    expect(LIFECYCLE_ACTION_META.end.destructive).toBe(true);
    expect(LIFECYCLE_ACTION_META.interrupt.destructive).toBe(true);
    expect(LIFECYCLE_ACTION_META.cancel.destructive).toBe(true);
    expect(LIFECYCLE_ACTION_META.start.destructive).toBe(false);
    expect(LIFECYCLE_ACTION_META.prepare.destructive).toBe(false);
    expect(LIFECYCLE_ACTION_META.resume.destructive).toBe(false);
  });
});
