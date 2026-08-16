import {
  formatDaysAhead,
  formatTodayHeading,
  kstDateOnly,
  kstWeekday,
  nextLive,
  scheduleFromToday,
  todaySlot,
} from '../schedule-clock';
import {
  EMERGENCY_SLOT,
  LIVE_COMMERCE_SLOTS_PENDING_M3,
  WEEKLY_SCHEDULE,
} from '../schedule-data';

/**
 * 편성 판정 단위 테스트 — 이 파일이 고정하는 것:
 *  ① 요일 판정이 **제주(KST) 기준**이며 기기 시간대와 무관하다(정적 페이지라 서버 보정이 없다)
 *  ② 편성 표 내용이 정본(01 §C-5 / CLAUDE.md §2)과 어긋나지 않는다
 *  ③ "다음 생방송"이 토·일 편성에서 실제로 도출된다
 */

// 2026-08-15T14:59:59.999Z = KST 2026-08-15(토) 23:59:59.999
const SAT_KST_LAST_MS = Date.parse('2026-08-15T14:59:59.999Z');
// 2026-08-15T15:00:00.000Z = KST 2026-08-16(일) 00:00:00 — UTC로는 아직 토요일이다
const SUN_KST_FIRST_MS = Date.parse('2026-08-15T15:00:00.000Z');

describe('kstWeekday — +09:00 보정 후 UTC getter만', () => {
  it('KST 토요일 23:59:59.999는 토(6)', () => {
    expect(kstWeekday(new Date(SAT_KST_LAST_MS))).toBe(6);
  });

  it('KST 일요일 00:00은 일(0) — 같은 순간 UTC는 아직 토요일이다', () => {
    // 기기(=UTC)의 요일과 제주의 요일이 갈리는 지점. 로컬 getter를 썼다면 여기서 6이 나온다.
    expect(new Date(SUN_KST_FIRST_MS).getUTCDay()).toBe(6);
    expect(kstWeekday(new Date(SUN_KST_FIRST_MS))).toBe(0);
  });

  it('일~토 7일이 0~6으로 순서대로 나온다', () => {
    // 2026-08-16(일) KST 정오 = 2026-08-16T03:00Z 부터 하루씩
    const days = Array.from({ length: 7 }, (_, i) =>
      kstWeekday(new Date(Date.parse('2026-08-16T03:00:00.000Z') + i * 86_400_000)),
    );
    expect(days).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('기기 시간대(TZ)가 무엇이든 같은 순간이면 같은 요일이다', () => {
    // Date는 시간대와 무관한 절대 시각(epoch ms)이고, 판정이 로컬 getter를 쓰지 않으므로
    // 프로세스 TZ가 UTC+14든 UTC-11이든 아래 결과가 바뀔 여지가 없다. 그 성질을 문서화하면서
    // 실제로 TZ를 바꿔 돌리는 검증은 `TZ=... pnpm --filter @gachinol/subscriber test`로 수행한다.
    const instant = new Date(SUN_KST_FIRST_MS);
    expect(kstWeekday(instant)).toBe(0);
    expect(kstDateOnly(instant)).toBe('2026-08-16');
  });
});

describe('kstDateOnly', () => {
  it('KST 자정 직전/직후로 날짜가 넘어간다', () => {
    expect(kstDateOnly(new Date(SAT_KST_LAST_MS))).toBe('2026-08-15');
    expect(kstDateOnly(new Date(SUN_KST_FIRST_MS))).toBe('2026-08-16');
  });
});

describe('편성 데이터 — 정본(01 §C-5 / CLAUDE.md §2) 정합', () => {
  it('일~토 7행이 요일 번호 0~6으로 빠짐없이 정의돼 있다', () => {
    expect(WEEKLY_SCHEDULE.map((s) => s.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('생방송은 토·일 2건뿐이다 — 월~금은 지사 촬영분 업로드(라이브 아님)', () => {
    const liveDays = WEEKLY_SCHEDULE.filter((s) => s.kind === 'live').map((s) => s.weekday);
    expect(liveDays.sort()).toEqual([0, 6]);
    expect(WEEKLY_SCHEDULE.filter((s) => s.weekday >= 1 && s.weekday <= 5).every((s) => s.kind === 'vod')).toBe(true);
  });

  it('토요일 주간뉴스만 유튜브·페이스북 동시 안내를 단다(CLAUDE.md §3-1)', () => {
    const withSimulcast = WEEKLY_SCHEDULE.filter((s) => s.simulcastLabel !== null);
    expect(withSimulcast).toHaveLength(1);
    expect(withSimulcast[0]?.weekday).toBe(6);
  });

  it('생방송에만 회당 길이(01 §C-5 V1 = 2시간)를 표기한다', () => {
    for (const slot of WEEKLY_SCHEDULE) {
      expect(slot.durationLabel === null).toBe(slot.kind !== 'live');
    }
    expect(WEEKLY_SCHEDULE.filter((s) => s.kind === 'live').map((s) => s.durationLabel)).toEqual([
      '약 2시간',
      '약 2시간',
    ]);
  });

  it('시작 시각을 지어내지 않는다 — 표 어디에도 시:분이 없다', () => {
    // 정본(01 §C-5·04 §A SLO#2)에 방송 시작 시각이 정의돼 있지 않다. 누군가 임의 시각을
    // 넣으면 여기서 실패한다.
    const text = JSON.stringify(WEEKLY_SCHEDULE);
    expect(text).not.toMatch(/\d{1,2}\s*시\s*\d/);
    expect(text).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it('긴급 방송은 요일 표 밖에 있다(캘린더 예외) — weekday -1', () => {
    expect(EMERGENCY_SLOT.kind).toBe('emergency');
    expect(EMERGENCY_SLOT.weekday).toBe(-1);
    expect(WEEKLY_SCHEDULE.some((s) => s.kind === 'emergency')).toBe(false);
  });

  it('M3 대기 중인 라이브커머스 방송은 아직 편성표에 실리지 않는다', () => {
    // 01 §C-5 램프상 M3부터 발효 — 그 전에 켜지면 시청자에게 거짓이 된다.
    const titles = new Set(WEEKLY_SCHEDULE.map((s) => s.title));
    for (const pending of LIVE_COMMERCE_SLOTS_PENDING_M3) {
      expect(titles.has(pending.title)).toBe(false);
    }
  });
});

describe('todaySlot', () => {
  it('KST 토요일이면 주간뉴스 생방송', () => {
    expect(todaySlot(new Date(SAT_KST_LAST_MS)).title).toBe('주간뉴스 생방송');
  });

  it('KST 일요일이면 교양·정치인 대담 생방송 — UTC 기준으로는 토요일인 순간에도', () => {
    expect(todaySlot(new Date(SUN_KST_FIRST_MS)).title).toBe('교양·정치인 대담 생방송');
  });

  it('KST 수요일이면 애월 교양', () => {
    // 2026-08-19(수) KST 정오
    expect(todaySlot(new Date('2026-08-19T03:00:00.000Z')).weekday).toBe(3);
  });
});

describe('nextLive — 다음 생방송 판정', () => {
  const at = (iso: string) => nextLive(new Date(iso));

  it('토요일 당일이면 오늘(daysAhead 0)', () => {
    expect(at('2026-08-15T03:00:00.000Z')).toMatchObject({ daysAhead: 0 });
    expect(at('2026-08-15T03:00:00.000Z')?.slot.weekday).toBe(6);
  });

  it('일요일 당일이면 오늘(daysAhead 0)', () => {
    expect(at('2026-08-16T03:00:00.000Z')).toMatchObject({ daysAhead: 0 });
    expect(at('2026-08-16T03:00:00.000Z')?.slot.weekday).toBe(0);
  });

  it('월요일이면 5일 뒤 토요일', () => {
    expect(at('2026-08-17T03:00:00.000Z')).toMatchObject({ daysAhead: 5 });
    expect(at('2026-08-17T03:00:00.000Z')?.slot.weekday).toBe(6);
  });

  it('금요일이면 내일(토요일)', () => {
    expect(at('2026-08-21T03:00:00.000Z')).toMatchObject({ daysAhead: 1 });
    expect(at('2026-08-21T03:00:00.000Z')?.slot.weekday).toBe(6);
  });

  it('KST 자정 경계에서 판정이 바뀐다 — 토 23:59는 오늘, 일 00:00도 오늘(일요일 방송)', () => {
    expect(at('2026-08-15T14:59:59.999Z')?.slot.weekday).toBe(6);
    expect(at('2026-08-15T15:00:00.000Z')?.slot.weekday).toBe(0);
  });

  it('7일 안에 반드시 생방송이 있다(토·일 편성) — null이 나오지 않는다', () => {
    for (let i = 0; i < 7; i += 1) {
      expect(nextLive(new Date(Date.parse('2026-08-16T03:00:00.000Z') + i * 86_400_000))).not.toBeNull();
    }
  });
});

describe('formatDaysAhead', () => {
  it.each([
    [0, '오늘'],
    [1, '내일'],
    [2, '2일 뒤'],
    [6, '6일 뒤'],
  ])('%i → %s', (input, expected) => {
    expect(formatDaysAhead(input)).toBe(expected);
  });

  it('편성 주기(0~6) 밖이면 라벨을 지어내지 않고 빈 문자열', () => {
    expect(formatDaysAhead(-1)).toBe('');
    expect(formatDaysAhead(7)).toBe('');
    expect(formatDaysAhead(1.5)).toBe('');
    expect(formatDaysAhead(NaN)).toBe('');
  });
});

describe('scheduleFromToday — 오늘을 맨 위로', () => {
  it('수요일이면 수→목→금→토→일→월→화 순으로 7행', () => {
    const order = scheduleFromToday(new Date('2026-08-19T03:00:00.000Z')).map((s) => s.weekday);
    expect(order).toEqual([3, 4, 5, 6, 0, 1, 2]);
  });

  it('요일이 무엇이든 7행이 중복 없이 전부 나온다', () => {
    for (let i = 0; i < 7; i += 1) {
      const week = scheduleFromToday(new Date(Date.parse('2026-08-16T03:00:00.000Z') + i * 86_400_000));
      expect(new Set(week.map((s) => s.weekday)).size).toBe(7);
    }
  });
});

describe('formatTodayHeading', () => {
  it('제주 기준 날짜·요일을 쓴다 — KST 일요일 00:00은 8월 16일 일요일', () => {
    expect(formatTodayHeading(new Date(SUN_KST_FIRST_MS))).toBe('2026년 8월 16일 일요일');
  });

  it('같은 순간이라도 1ms 전은 8월 15일 토요일', () => {
    expect(formatTodayHeading(new Date(SAT_KST_LAST_MS))).toBe('2026년 8월 15일 토요일');
  });
});
