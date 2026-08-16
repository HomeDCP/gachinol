/** EXPO_PUBLIC_API_URL — 번들 인라인 공개 값. 호출 시점 평가 (import 시점 throw 금지) */
export function getApiBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (url) return url.replace(/\/$/, '');
  if (__DEV__) {
    console.warn(
      'EXPO_PUBLIC_API_URL 미설정 — http://localhost:4000 사용 (apps/subscriber/.env 참조)',
    );
    return 'http://localhost:4000';
  }
  throw new Error('EXPO_PUBLIC_API_URL이 설정되지 않았습니다');
}

/**
 * 재생 실패 폴백(03 §A-6)의 대체 채널 — 지사별 실 연락처·유튜브 채널은 아직 공개 API 계약에
 * 없다(전화번호는 개인정보라 공용 계약 제외 — `packages/shared/src/user/community-figure.ts` 주석,
 * YouTube 채널 URL 필드도 `LiveSessionPublic`/`StationSummary`에 미정의). 이 태스크는
 * `apps/subscriber/**` 파일 소유 배타라 shared·api 확장이 불가하므로, 값이 없으면 버튼을 비활성
 * 표시한다(가짜 번호·채널 링크를 지어내지 않는다 — [판정 요청], 실 데이터 배선은 후속 태스크).
 * `.env.example`(루트 파일, 파일 소유 배타 밖) 미등재는 알려진 처리 — 완료 보고에 명시한다.
 */
export function getSupportTelHref(): string | null {
  const tel = process.env.EXPO_PUBLIC_SUPPORT_TEL?.trim();
  return tel ? `tel:${tel}` : null;
}

/** 라이브 재생 실패 시 대체 시청 경로(03 §A-6 "유튜브에서 보기") — 위와 동일 사유로 미설정 시 null */
export function getLiveFallbackYoutubeUrl(): string | null {
  const url = process.env.EXPO_PUBLIC_LIVE_YOUTUBE_URL?.trim();
  return url ? url : null;
}
