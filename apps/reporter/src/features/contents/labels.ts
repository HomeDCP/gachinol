import type { CultureTopic, ProgramCategory } from '@gachinol/shared';

/** 카테고리 6종 라벨 — satisfies Record로 전수 강제 (카테고리 추가 시 tsc가 잡음) */
export const CATEGORY_LABEL = {
  news: '뉴스',
  politics_talk: '정치인 대담',
  culture: '교양',
  local_weather: '지역 날씨',
  live_commerce: '라이브커머스',
  emergency: '긴급',
} as const satisfies Record<ProgramCategory, string>;

/** 카테고리 보조 안내 (선택) */
export const CATEGORY_HELP: Partial<Record<ProgramCategory, string>> = {
  emergency: '긴급은 최우선 처리되며 AI 분석을 생략할 수 있습니다',
};

/** 교양 하위 토픽 10종 라벨 */
export const CULTURE_TOPIC_LABEL = {
  reading: '독서',
  cooking: '요리',
  travel_spot: '여행지',
  tourism: '관광',
  lodging: '숙소',
  guesthouse: '민박',
  festival: '지역축제',
  food: '먹거리',
  farmer: '농민',
  producer: '생산자',
} as const satisfies Record<CultureTopic, string>;
