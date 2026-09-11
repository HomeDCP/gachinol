// apps/reporter/jest.web.config.js — 웹 플랫폼 해석 축 전용 jest 설정 (QUEUE 2-2, 대장 #178).
//
// ⚠️ 파일명이 `jest.config.web.js`가 아니라 `jest.web.config.js`인 이유: `.web.js`로 끝나는
// 파일명은 infra/scripts/web-platform-test-gate.mjs(동반 의무 D1 게이트)의 `.web.*` 탐지
// 정규식(`/\.web\.(ts|tsx|js|jsx)$/`)에 그대로 걸려 이 설정 파일 자신이 "플랫폼 해석 대상"으로
// 오탐된다(실측: 최초 `jest.config.web.js`로 만들었을 때 게이트가 즉시 위반으로 잡았다). 이름
// 순서를 바꿔 오탐의 근본 원인 자체를 없앴다(게이트 쪽에 "jest.config.*는 예외" 같은 임시
// 처리를 추가하는 대신).
//
// ── 왜 별도 설정인가 ──────────────────────────────────────────────────────────
// `jest.config.js`(네이티브, `preset: 'jest-expo'`)는 react-native/jest-preset.js의
// `haste: { defaultPlatform: 'ios', platforms: ['android','ios','native'] }`를 그대로 물려받는다
// — `'web'`이 그 배열에 없어 `.web.*` 파일은 어느 테스트에서도 로드되지 않는다(대장 #178).
// `jest-expo/web`(`getWebPreset()`)은 `haste.platforms=['web']`·`testEnvironment='jsdom'`·
// `moduleNameMapper['^react-native$']='react-native-web'`·`moduleFileExtensions`를
// `['web.ts','web.tsx','web.js','web.jsx','ts',...]`(web이 최우선)로 바꿔줘 접미사 없는
// import(`from '../http-upload-service'`)가 `.web.ts`로 해석되게 한다.
//
// 이 프리셋을 네이티브 설정에 합치지 않고 완전히 별도 파일 + 별도 스크립트(`test:web`)로
// 격리하는 이유: `jest-expo/config/getPlatformPreset.js`는 testMatch를 `['', 'web']`로
// flatMap해 일반 테스트 파일과 `.web.` 접미사 테스트 파일을 둘 다 매칭 패턴에 올린다. 네이티브
// 설정이 쓰는 testMatch(도트 test 파일을 __tests__ 하위에서 찾는 패턴)를 웹 프로젝트에 그대로
// 주면 기존 31개 네이티브 스위트가 jsdom+react-native-web에서 재실행되고, `src/test/setup.ts`의
// 네이티브 전제 목(expo-secure-store 등)이 깨진다(과제 §B 경고, 규율 18 "너무 넓은 재현은
// 오해소된다").
//
// ── 실행 확인 결과(추측 금지, 2026-09 — `jest --showConfig`로 실측) ────────────────
//  · moduleNameMapper — 병합된다(프로젝트 값이 배열 앞쪽에, 프리셋 값이 뒤에 이어붙는다).
//    `^react-native$` → react-native-web alias가 살아남는다 — 아래 moduleNameMapper를
//    따로 둬도 그 alias를 밀어내지 않는다.
//  · setupFiles — 병합된다(프리셋 setup-web.js가 먼저, 프로젝트 값이 있다면 그 뒤).
//    이 설정은 프로젝트 setupFiles를 비워둔다 — 대상 .web.* 파일 중 어느 것도
//    expo-secure-store/expo-video를 참조하지 않아 네이티브용 src/test/setup.ts가 불요하다.
//  · transformIgnorePatterns — 프로젝트가 값을 두면 프리셋 값을 완전 대체한다(병합 아님).
//    이 설정은 일부러 이 키를 두지 않는다 — 프리셋 기본값(.pnpm|react-native|expo|... 화이트
//    리스트)을 그대로 쓴다. reporter의 웹 대상(http-upload-service.web.ts)은 외부 런타임
//    의존이 0이라 이 값이 무엇이든 영향이 없다(subscriber 쪽은 hls.js·workbox-window가
//    걸려 있어 그쪽 설정 주석에 상세 근거가 있다).
//
// ── 스캔 대상(testMatch) ─────────────────────────────────────────────────────
// 기존 __tests__ 디렉터리가 아니라 전용 __web_tests__ 디렉터리만 본다. 기존 __tests__를
// 공유하면 네이티브 testMatch가 같은 파일을 또 집어 네이티브 축에서도 실행한다(웹 전용
// XHR 목·jsdom 전제가 네이티브 축에서 깨진다).
//
// ⚠️ 이 파일에 JSDoc 블록 주석(/* ... */)을 쓰지 않는다 — 위 설명에 등장하는 글롭 패턴 자체에
// `*` + `/` 연속 문자가 들어가(예: 디렉터리 글롭의 별표-슬래시 연속) 블록 주석을 조기 종료시킨다
// (실측: 최초 작성 시 `SyntaxError: Unexpected identifier '__tests__'`로 즉시 재현됐다). 그래서
// 파일 전체를 줄 주석(//)으로 통일한다.
module.exports = {
  preset: 'jest-expo/web',
  rootDir: __dirname,
  clearMocks: true,
  testTimeout: 30000,
  testMatch: ['<rootDir>/src/**/__web_tests__/**/*.test.ts?(x)'],
  // 테스트도 shared를 "소스"로 소비 (네이티브 jest.config.js와 동일 원천 — 대상 파일이 실제로
  // 런타임에 @gachinol/shared를 참조하진 않지만(전부 import type), 앞으로 웹 축에 추가될 파일이
  // 참조할 수 있어 네이티브 설정과 동일하게 둔다).
  moduleNameMapper: { '^@gachinol/shared$': '<rootDir>/../../packages/shared/src/index.ts' },
};
