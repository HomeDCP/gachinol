/**
 * 07 §3-15 ⓑ 이용허락 클릭동의 판정 — null이면 동의 없이 접수된 건이다.
 * 서버 주석(resident-reviews.service.ts)이 이 값을 "검수자 판단 재료"로 명시한다 — 숨기지 않고
 * 화면에서 경고로 강조해야 한다(반려를 강제하지는 않는다, 최종 판단은 검수자 몫).
 *
 * 타입 가드(`v is null`)로 선언한 이유 — qa-verifier 결함② 재발 방지: 상세 화면이 이 판정을
 * `=== null` 재구현으로 사본을 만들면, 그 사본이 실제로 경고 박스를 그리는데 테스트는 이 함수만
 * 본다(둘이 갈라져도 테스트가 못 잡는다). 호출부가 항상 이 함수를 직접 조건으로 써야 하고, 타입
 * 가드면 `formatDateTime(consentAgreedAt)` 분기에서 `string`으로 좁혀져 non-null assertion(`!`) 없이도
 * "사본을 새로 만들 유인"이 사라진다.
 */
export function isConsentMissing(consentAgreedAt: string | null): consentAgreedAt is null {
  return consentAgreedAt === null;
}
