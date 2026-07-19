/**
 * 시간 문자열은 브랜드 없는 alias — JSON 직렬화 경계라 캐스팅 마찰 대비 혼용 위험이 낮다.
 */

/** UTC ISO 8601 (예: '2026-07-19T09:00:00.000Z') — 모든 타임스탬프의 wire format. 저장·전송은 항상 UTC */
export type ISODateString = string;

/** 날짜만 (예: '2026-07-20') — 예보 대상일·주차 기준일 등 "Asia/Seoul 기준 날짜 개념"에만 사용 */
export type ISODateOnlyString = string;

/** 생성·수정 타임스탬프 공통 필드 */
export interface Timestamps {
  createdAt: ISODateString;
  updatedAt: ISODateString;
}
