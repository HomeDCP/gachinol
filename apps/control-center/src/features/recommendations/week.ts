/**
 * 주차(weekOf) 계산 — 서버 `mondayOfWeekKst`의 앱 측 미러.
 * ★ 로컬 시간 getter 절대 금지: +09:00 오프셋을 더한 뒤 UTC getter만 쓴다.
 *   (기기 시간대가 KST가 아니어도 "제주 기준 주차"가 흔들리지 않아야 한다.)
 * 서버가 어차피 정규화하므로 이 값은 편의용이지만, 화면 라벨과 서버 저장값이 일치해야 혼선이 없다.
 */

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 'YYYY-MM-DD' → UTC 자정 Date (서버 fromDateOnly 동형). 형식 위반·무효 날짜면 null */
function parseDateOnly(dateOnly: string): Date | null {
  if (!DATE_ONLY_RE.test(dateOnly)) return null;
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 현재 시각 기준 그 주 월요일(Asia/Seoul) — 'YYYY-MM-DD' */
export function currentWeekOfKst(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  // getUTCDay: 0=일 … 6=토 → 월요일까지 되돌릴 일수
  const daysSinceMonday = (kst.getUTCDay() + 6) % 7;
  return new Date(kst.getTime() - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}

/** 주차 범위 '6/1~6/7' — 월~일 7일. 형식 위반이면 입력 그대로 반환 */
export function formatWeekRange(weekOf: string): string {
  const start = parseDateOnly(weekOf);
  if (!start) return weekOf;
  const end = new Date(start.getTime() + 6 * DAY_MS);
  return `${start.getUTCMonth() + 1}/${start.getUTCDate()}~${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
}

/** 목록·상세 헤더 라벨 '2026-06-01 주 · 6/1~6/7' */
export function formatWeekLabel(weekOf: string): string {
  const start = parseDateOnly(weekOf);
  if (!start) return weekOf;
  return `${weekOf} 주 · ${formatWeekRange(weekOf)}`;
}
