/**
 * 편성 판정 순수 함수 — "오늘은 무슨 요일(제주 기준)인가 / 다음 생방송은 언제인가".
 *
 * ★ 로컬 시간 getter 절대 금지: `+09:00`을 더한 뒤 **UTC getter만** 쓴다.
 *   (`apps/control-center/src/features/recommendations/week.ts`의 `currentWeekOfKst` 선례와 동형.)
 *   이 페이지는 시청자 기기에서 그대로 도는 정적 자산이라 **서버가 요일을 보정해 주지 않는다** —
 *   기기 시간대가 KST가 아니면(해외 거주 제주 출신 시청자, 시간대가 어긋난 구형 기기) 편성표가
 *   하루 밀린다. 서버 보정이 없다는 점에서 control-center의 선례보다 오히려 더 중요하다.
 *
 * 화면은 판정을 하지 않고 이 함수들의 결과를 렌더하기만 한다(판정이 테스트로 고정되도록).
 */
import { EMERGENCY_SLOT, WEEKLY_SCHEDULE } from './schedule-data';
import type { ScheduleSlot } from './schedule-data';

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAYS_IN_WEEK = 7;

/** 제주(Asia/Seoul) 기준 요일 — 0=일 … 6=토. 기기 시간대와 무관하다. */
export function kstWeekday(now: Date = new Date()): number {
  return new Date(now.getTime() + KST_OFFSET_MS).getUTCDay();
}

/** 제주 기준 오늘 날짜 'YYYY-MM-DD' — 화면 상단 "오늘" 라벨용 */
export function kstDateOnly(now: Date = new Date()): string {
  return new Date(now.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 제주 기준 오늘의 편성 슬롯.
 * `WEEKLY_SCHEDULE`은 weekday 오름차순 7행이므로 인덱스 = 요일이지만, 순서에 의존하지 않고
 * `weekday`로 찾는다(표 순서를 바꿔도 판정이 흔들리지 않게).
 */
export function todaySlot(now: Date = new Date()): ScheduleSlot {
  const weekday = kstWeekday(now);
  const slot = WEEKLY_SCHEDULE.find((s) => s.weekday === weekday);
  // 7행 전수 정의라 도달 불가. 편성표를 잘못 편집해 요일이 비면 긴급 슬롯으로 무해하게 떨어진다
  // (화면이 undefined로 죽는 것보다 낫다 — 이 폴백이 실제로 쓰이면 편성표 편집이 잘못된 것이다).
  return slot ?? EMERGENCY_SLOT;
}

export interface NextLive {
  readonly slot: ScheduleSlot;
  /** 오늘로부터 며칠 뒤인가. 0 = 오늘 */
  readonly daysAhead: number;
}

/**
 * 다음(또는 오늘의) 생방송 — 오늘부터 최대 6일 뒤까지 훑어 처음 만나는 `kind: 'live'` 슬롯.
 *
 * 오늘이 생방송 요일이면 `daysAhead: 0`을 돌려준다 — **시각 정보가 정본에 없으므로**(schedule-data
 * 상단 주석) "오늘 방송이 이미 끝났는지"는 판정할 수 없다. 끝난 방송을 "오늘 있습니다"라고 말하는
 * 쪽이, 아직 안 한 방송을 "다음 주"라고 말하는 쪽보다 덜 해롭다(전자는 편성표를 다시 보게 하고,
 * 후자는 시청 자체를 놓치게 한다). **정본에 시작 시각이 확정되면 시각 비교로 바꾼다.**
 *
 * 편성에 생방송이 하나도 없으면 null(현재 편성으로는 도달 불가 — 토·일 2건).
 */
export function nextLive(now: Date = new Date()): NextLive | null {
  const today = kstWeekday(now);
  for (let daysAhead = 0; daysAhead < DAYS_IN_WEEK; daysAhead += 1) {
    const weekday = (today + daysAhead) % DAYS_IN_WEEK;
    const slot = WEEKLY_SCHEDULE.find((s) => s.weekday === weekday && s.kind === 'live');
    if (slot) return { slot, daysAhead };
  }
  return null;
}

/** '오늘' / '내일' / 'N일 뒤' — 음수·7 이상은 편성 주기 밖이라 빈 문자열(라벨을 지어내지 않는다) */
export function formatDaysAhead(daysAhead: number): string {
  if (!Number.isInteger(daysAhead) || daysAhead < 0 || daysAhead >= DAYS_IN_WEEK) return '';
  if (daysAhead === 0) return '오늘';
  if (daysAhead === 1) return '내일';
  return `${daysAhead}일 뒤`;
}

/**
 * 오늘부터 7일치를 요일 순서로 재배열한다 — 편성표를 "일요일부터"가 아니라 "오늘부터" 보여주기
 * 위한 것. 어르신 접근성(03 §A) 관점에서 오늘 줄을 맨 위에 두는 편이 훑기 쉽다.
 */
export function scheduleFromToday(now: Date = new Date()): readonly ScheduleSlot[] {
  const today = kstWeekday(now);
  const ordered: ScheduleSlot[] = [];
  for (let daysAhead = 0; daysAhead < DAYS_IN_WEEK; daysAhead += 1) {
    const weekday = (today + daysAhead) % DAYS_IN_WEEK;
    const slot = WEEKLY_SCHEDULE.find((s) => s.weekday === weekday);
    if (slot) ordered.push(slot);
  }
  return ordered;
}

/** 표시용 — 제주 기준 오늘 날짜와 요일을 한 줄로. '2026년 8월 16일 일요일 (제주 기준)' */
export function formatTodayHeading(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const slot = todaySlot(now);
  return `${kst.getUTCFullYear()}년 ${kst.getUTCMonth() + 1}월 ${kst.getUTCDate()}일 ${slot.dayLabel}`;
}
