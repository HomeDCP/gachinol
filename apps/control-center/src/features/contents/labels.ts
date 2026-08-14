import type { CultureTopic, Platform, ProgramCategory, PublicationStatus } from '@gachinol/shared';
import type { BadgeToneName } from '../../ui/theme';

/** 카테고리 6종 라벨 — satisfies Record로 전수 강제 (카테고리 추가 시 tsc가 잡음) */
export const CATEGORY_LABEL = {
  news: '뉴스',
  politics_talk: '정치인 대담',
  culture: '교양',
  local_weather: '지역 날씨',
  live_commerce: '라이브커머스',
  emergency: '긴급',
} as const satisfies Record<ProgramCategory, string>;

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

/** 송출 플랫폼 7종 라벨 — satisfies Record로 전수 강제(플랫폼 추가 시 tsc가 잡음) */
export const PLATFORM_LABEL = {
  kakao: '카카오톡 채널',
  youtube: 'YouTube',
  facebook: 'Facebook',
  instagram: 'Instagram',
  x: 'X',
  threads: 'Threads',
  app: '자체 앱',
} as const satisfies Record<Platform, string>;

/**
 * 채널 단위 송출 상태 6종 — 배지 톤은 Content 상태 배지와 같은 어휘를 쓴다.
 * 전이 규칙은 shared PUBLICATION_STATUS_TRANSITIONS가 원천이며 여기서 사본을 만들지 않는다.
 */
export const PUBLICATION_STATUS_LABEL = {
  queued: '대기',
  publishing: '송출 중',
  published: '송출 완료',
  failed: '실패',
  retracted: '회수됨',
  canceled: '취소됨',
} as const satisfies Record<PublicationStatus, string>;

export const PUBLICATION_STATUS_TONE = {
  queued: 'neutral',
  publishing: 'progress',
  published: 'success',
  failed: 'danger',
  retracted: 'warning',
  canceled: 'neutral',
} as const satisfies Record<PublicationStatus, BadgeToneName>;
