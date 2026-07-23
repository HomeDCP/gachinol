/**
 * 추천 근거·총평 파생 — 순수 함수(DB·Nest 무의존). 결정적: 같은 입력 → 같은 문자열.
 * ★ 실 ML 재랭킹·재요약 없음. 기존 ai_analyses.text(요약·키워드)와 점수만 재사용한다.
 */

const MAX_SENTENCE_LEN = 80;
const MAX_KEYWORDS = 3;

export interface ReasonInput {
  /** ai_analyses.text.summary */
  summary?: string;
  /** ai_analyses.text.keywords */
  keywords?: readonly string[];
  /** recommendationScore (null→0으로 정규화된 값) */
  score: number;
  /** 1부터 */
  rank: number;
}

const firstSentence = (text: string): string => {
  const trimmed = text.trim();
  // 문장 종결부호(., !, ?, 。) 기준 첫 문장. 없으면 전체.
  const m = /^[\s\S]*?[.!?。]/.exec(trimmed);
  const head = (m ? m[0] : trimmed).trim();
  return head.length > MAX_SENTENCE_LEN ? `${head.slice(0, MAX_SENTENCE_LEN - 1)}…` : head;
};

const keywordTail = (keywords: readonly string[] | undefined): string => {
  const picked = (keywords ?? []).filter((k) => k.trim().length > 0).slice(0, MAX_KEYWORDS);
  return picked.length ? `키워드: ${picked.join('·')}` : '';
};

/**
 * 3분기:
 *  ① summary 있음 → 첫 문장(≤80자) [+ ' · 키워드: k1·k2·k3']
 *  ② summary 없고 keywords만 → '키워드: k1·k2·k3'
 *  ③ 둘 다 없음 → 'AI 요약 없음 — 추천 점수 {score} 기준 상위 {rank}위'
 */
export const buildReason = ({ summary, keywords, score, rank }: ReasonInput): string => {
  const tail = keywordTail(keywords);
  const head = summary?.trim() ? firstSentence(summary) : '';
  if (head) return tail ? `${head} · ${tail}` : head;
  if (tail) return tail;
  return `AI 요약 없음 — 추천 점수 ${score.toFixed(2)} 기준 상위 ${rank}위`;
};

export interface WeeklySummaryInput {
  weekOf: string;
  candidateCount: number;
  selectedCount: number;
  /** 선정 항목의 분류(ProgramCategory) 분포 */
  categoryCounts: Readonly<Record<string, number>>;
  generation: number;
  /** 재생성이면 수정 지시 원문(총평 접두로 반영) */
  revisionNote?: string;
}

/**
 * 총평 — 후보수/선정수/분류분포. 재생성이면 수정 지시를 접두한다.
 * ★ 접두가 필요한 이유: shared `RecommendationReview`에 수정요청 이력 필드가 없어
 *   "이번 세대가 무엇을 반영했는지"를 센터에 보여줄 통로가 summary뿐이다.
 */
export const buildWeeklySummary = ({
  weekOf,
  candidateCount,
  selectedCount,
  categoryCounts,
  generation,
  revisionNote,
}: WeeklySummaryInput): string => {
  const dist = Object.entries(categoryCounts)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([category, count]) => `${category} ${count}`)
    .join(' · ');
  const base = `${weekOf} 주간 — 후보 ${candidateCount}건 중 ${selectedCount}건 선정${
    dist ? ` · 분류 ${dist}` : ''
  }`;
  if (generation <= 1 || !revisionNote?.trim()) return base;
  const note = revisionNote.trim().slice(0, 100);
  return `[재생성 g${generation} — 수정 지시: ${note}] ${base}`;
};
