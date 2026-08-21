// @ts-check
// RN/Expo 프리셋(base + React Hooks) — 규칙은 packages/config가 단일 원천(대장 #122).
import react from '@gachinol/config/eslint/react';

export default [
  ...react,
  {
    // Metro·Babel 설정은 CJS라 require()가 정상이다(RN 툴체인 요구).
    files: ['metro.config.js', 'babel.config.js', 'jest.config.js'],
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
];
