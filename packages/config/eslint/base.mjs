// @ts-check
import tseslint from 'typescript-eslint';

/* ══════════════════════════════════════════════════════════════════════════
 * 워크스페이스 공통 eslint 프리셋 — 대장 #122.
 *
 * ★ 왜 지금 만드는가
 *   `pnpm lint`는 `turbo run lint`인데, **lint 스크립트를 가진 워크스페이스가 api·media-worker
 *   둘뿐**이었다. turbo는 스크립트가 없는 패키지를 조용히 건너뛰므로 CI는 초록불인 채로
 *   **앱 3종·shared·ui를 한 줄도 검사하지 않았다**(#122). "실행됐다"와 "검사됐다"가 다른 전형이다.
 *
 * ★ 규칙을 여기 모으는 이유
 *   api·media-worker가 같은 설정을 각자 복제하고 있었다. 규칙이 늘어날 때마다 사본이 갈라지고,
 *   갈라진 것을 아무도 눈치채지 못한다(이 리포가 반복해 밟은 형태 — `not-wired` 사유·공개 자산
 *   선택 규칙 사본 2벌 등). 프리셋 1개 + 워크스페이스별 `ignores`만 두는 구조로 고정한다.
 *
 * ★ 규칙 강도는 "지금 지켜지고 있는 수준"에 맞춘다
 *   도입 시점 실측 위반 17건은 전부 해소했으나, 강도를 더 올리면(예: type-aware 규칙) 수백 건이
 *   되어 게이트가 무력화된다(끄거나 무시하게 된다). **먼저 초록불을 유지 가능한 선에서 켜고**,
 *   규칙 추가는 별도 태스크로 한다. 켜져 있지 않은 게이트는 강도가 아무리 높아도 0이다.
 * ══════════════════════════════════════════════════════════════════════════ */

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/node_modules/**',
      '**/.expo/**',
      '**/.turbo/**',
    ],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      /**
       * `_` 접두는 **의도적 미사용**의 관례다 — 인자뿐 아니라 변수·구조분해에도 쓴다.
       * 舊 api 설정은 `argsIgnorePattern`만 둬서 `const [, _ignored] = ...`나
       * 타입 검산용 `type _AssertAckComplete = ...`(shared realtime/events.ts)가 걸렸다.
       * 그 선언들은 존재 자체가 목적이므로(tsc가 검산한다) 규칙이 아니라 패턴이 옳다.
       */
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
        },
      ],
      /** shared 브랜디드 타입 경계 캐스팅·NestJS 데코레이터 패턴과 충돌 */
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    /**
     * 테스트 파일 — `require()`를 허용한다.
     * jest의 모듈 모킹은 **호이스팅 때문에** `jest.mock()` 뒤에 `require()`로 다시 읽어야
     * 모킹된 인스턴스를 잡는다(정적 `import`는 모킹 전에 평가된다). 규칙을 켜두면 파일마다
     * `eslint-disable`이 붙어 결국 아무도 안 읽는 주석이 된다.
     */
    files: ['**/*.test.ts', '**/*.test.tsx', '**/*.spec.ts', '**/*.spec.tsx', '**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    /** 쓰이지 않게 된 `eslint-disable`은 지운다 — 남으면 "이 규칙이 켜져 있다"는 착각을 준다 */
    linterOptions: { reportUnusedDisableDirectives: 'error' },
  },
);
