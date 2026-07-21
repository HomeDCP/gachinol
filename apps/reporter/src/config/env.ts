/** EXPO_PUBLIC_API_URL — 번들 인라인 공개 값. 호출 시점 평가 (import 시점 throw 금지) */
export function getApiBaseUrl(): string {
  const url = process.env.EXPO_PUBLIC_API_URL;
  if (url) return url.replace(/\/$/, '');
  if (__DEV__) {
    console.warn(
      'EXPO_PUBLIC_API_URL 미설정 — http://localhost:4000 사용 (apps/reporter/.env 참조)',
    );
    return 'http://localhost:4000';
  }
  throw new Error('EXPO_PUBLIC_API_URL이 설정되지 않았습니다');
}
