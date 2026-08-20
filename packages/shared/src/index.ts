/**
 * @gachinol/shared 배럴 — 전 모듈 재수출 (사이드이펙트 금지)
 */

// common
export * from './common/brand';
export * from './common/id';
export * from './common/time';
export * from './common/money';
export * from './common/pagination';
export * from './common/api-error';
export * from './common/state-machine';

// auth
export * from './auth/dto';

// station
export * from './station/station';
export * from './station/dto';

// user
export * from './user/user';
export * from './user/dto';
export * from './user/community-figure';

// content
export * from './content/category';
export * from './content/workflow';
// 미구동 계약 레지스트리 — workflow(합법성) 바로 옆에 둔다(EXEC-DECISIONS #29 1계층)
export * from './content/not-wired';
export * from './content/content';
export * from './content/revision-request';
export * from './content/dto';

// media
export * from './media/edit-plan';
export * from './media/media-asset';
export * from './media/media-job';

// resident (주민 업로드 검수 — T-W2-25a shared 승격)
export * from './resident/resident-upload-status';

// job
export * from './job/job';

// analysis
export * from './analysis/ai-analysis';
export * from './analysis/analysis-job';

// recommendation
export * from './recommendation/weekly-recommendation';

// distribution
export * from './distribution/platform';
export * from './distribution/channel-account';
export * from './distribution/publication';
export * from './distribution/dto';

// live
export * from './live/live-session';
export * from './live/live-comment';
export * from './live/chat-message';

// commerce
export * from './commerce/product';
export * from './commerce/order';
export * from './commerce/media-sale';

// weather
export * from './weather/local-weather-forecast';

// audit
export * from './audit/transition-log';

// system (운영 상태 — 미디어 처리 게이트)
export * from './system/processing-state';

// telemetry (계측 이벤트 이름 카탈로그·봉투 상한 — T-W2-29 shared 승격, 대장 #128)
export * from './telemetry/telemetry-event';

// 합성 DTO
export * from './control/dto';
export * from './subscriber/dto';

// realtime
export * from './realtime/rooms';
export * from './realtime/events';
