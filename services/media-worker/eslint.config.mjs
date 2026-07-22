// @ts-check
import tseslint from 'typescript-eslint';

/** 최소 lint — 규칙 확장은 packages/config 공유 프리셋 도입 시(로드맵) */
export default tseslint.config(
  { ignores: ['dist/**', 'coverage/**', 'node_modules/**'] },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
