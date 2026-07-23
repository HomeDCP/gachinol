/**
 * 주차(weekOf) 순수 계산 — DB·Nest 무의존. 주간추천의 "그 주"를 정의하는 유일 원천.
 *
 * ★ 로컬 시간 getter(getDay/getFullYear/…) 절대 금지 — 서버 TZ에 따라 주차가 흔들린다.
 *   Asia/Seoul은 DST가 없어 +09:00 고정 오프셋 산술만으로 정확하다.
 */

/** Asia/Seoul 고정 오프셋(DST 없음) */
export const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → 그 날짜의 UTC 자정 Date (날짜만 개념의 정규 표현) */
export const parseDateOnly = (value: string): Date => {
  if (!DATE_ONLY_RE.test(value)) {
    throw new Error(`날짜 형식이 올바르지 않습니다(YYYY-MM-DD): ${value}`);
  }
  const ms = Date.parse(`${value}T00:00:00.000Z`);
  if (Number.isNaN(ms)) throw new Error(`존재하지 않는 날짜입니다: ${value}`);
  const d = new Date(ms);
  // '2026-02-31'처럼 파싱은 되지만 롤오버되는 값 차단
  if (toDateOnly(d) !== value) throw new Error(`존재하지 않는 날짜입니다: ${value}`);
  return d;
};

/**
 * parseDateOnly가 받아들이는 값인가 — 형식 + **실존 날짜**('2026-02-31' 거부).
 * 요청 스키마(zGenerateRecommendation)의 refine 술어 = 검증 규칙의 사본을 만들지 않는다.
 */
export const isDateOnly = (value: string): boolean => {
  try {
    parseDateOnly(value);
    return true;
  } catch {
    return false;
  }
};

/** Prisma `@db.Date`(UTC 자정 Date) → 'YYYY-MM-DD'. UTC 기반이라 서버 TZ 무관 */
export const toDateOnly = (date: Date): string => date.toISOString().slice(0, 10);

/**
 * 주중 아무 날짜('YYYY-MM-DD') → 그 주 **월요일**(Asia/Seoul) 'YYYY-MM-DD'.
 * 거부하지 않고 내림 정규화한다 — 관제가 화요일 날짜로 눌러도 같은 행에 수렴(멱등 강화).
 */
export const mondayOfWeekKst = (dateOnly: string): string => {
  const d = parseDateOnly(dateOnly);
  // 날짜만 값의 요일은 TZ와 무관하게 확정 — UTC 자정 기준 getUTCDay가 곧 KST 요일
  const shift = (d.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  return toDateOnly(new Date(d.getTime() - shift * DAY_MS));
};

/**
 * 주차 윈도우(UTC 반개구간) — `[weekOf 00:00 KST, +7d)`.
 * 예: weekOf='2026-06-01' → [2026-05-31T15:00Z, 2026-06-07T15:00Z)
 */
export const weekWindowUtc = (weekOfMonday: string): { start: Date; end: Date } => {
  const midnightKstAsUtc = parseDateOnly(weekOfMonday).getTime() - KST_OFFSET_MS;
  return { start: new Date(midnightKstAsUtc), end: new Date(midnightKstAsUtc + 7 * DAY_MS) };
};
