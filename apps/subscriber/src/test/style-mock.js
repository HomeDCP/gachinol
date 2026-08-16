/**
 * jest용 CSS 스텁 — `app/_layout.tsx`의 `import '../src/global.css'`(웹 전용 글로벌 스타일 진입점)을
 * jest가 JS로 파싱하려다 죽는 것을 막는다. Metro는 CSS를 자체 처리하므로 **프로덕션 번들과 무관**하다
 * (jest.config.js의 moduleNameMapper에서만 쓰인다).
 *
 * 이 스텁이 필요해진 이유: T-W1-04가 루트 레이아웃 렌더 테스트를 추가하면서 처음으로 jest가 `app/_layout.tsx`를
 * 로드하게 됐다. 그 전까지는 이 파일을 아무 테스트도 import하지 않아 드러나지 않았다.
 */
module.exports = {};
