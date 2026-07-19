/**
 * 분류 축 — 콘텐츠 분류와 라이브 유형은 동일 6종 축이므로 단일 ProgramCategory로 통합 공유한다.
 */
export const ProgramCategory = {
  /** 뉴스 (주간뉴스 소재/라이브) */
  News: 'news',
  /** 정치인 게스트 대담 */
  PoliticsTalk: 'politics_talk',
  /** 교양 (하위 토픽은 CultureTopic) */
  Culture: 'culture',
  /** 지역특화 날씨예보 — '감' 기반 */
  LocalWeather: 'local_weather',
  /** 로컬 라이브커머스 */
  LiveCommerce: 'live_commerce',
  /** 긴급 (재난·위기) — 패스트트랙·즉시 라이브 */
  Emergency: 'emergency',
} as const;
export type ProgramCategory = (typeof ProgramCategory)[keyof typeof ProgramCategory];

/** 교양 하위 토픽 — category='culture'일 때만 사용 (복수 선택 가능) */
export const CultureTopic = {
  /** 독서 */
  Reading: 'reading',
  /** 요리 */
  Cooking: 'cooking',
  /** 여행지 */
  TravelSpot: 'travel_spot',
  /** 관광 */
  Tourism: 'tourism',
  /** 숙소 */
  Lodging: 'lodging',
  /** 민박 */
  Guesthouse: 'guesthouse',
  /** 지역축제 */
  Festival: 'festival',
  /** 먹거리 */
  Food: 'food',
  /** 농민 */
  Farmer: 'farmer',
  /** 생산자 */
  Producer: 'producer',
} as const;
export type CultureTopic = (typeof CultureTopic)[keyof typeof CultureTopic];

/** 순수 헬퍼: culture만 하위 토픽 필수 (서버 검증에 사용) */
export const requiresCultureTopic = (c: ProgramCategory): boolean => c === ProgramCategory.Culture;
