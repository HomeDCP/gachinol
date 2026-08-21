// @ts-check
import reactHooks from 'eslint-plugin-react-hooks';
import base from './base.mjs';

/* ══════════════════════════════════════════════════════════════════════════
 * RN/Expo 앱용 프리셋 = base + React Hooks 규칙.
 *
 * ★ 왜 별도 파일인가 — 서버(api·media-worker)에는 훅이 없다. 거기까지 플러그인을 로드하면
 *   느려지기만 하고 잡을 것이 없다.
 *
 * ★ 도입 근거는 "있으면 좋아서"가 아니다 (대장 #122)
 *   앱 코드에 `eslint-disable-next-line react-hooks/exhaustive-deps` 주석이 **3곳** 있었는데
 *   **플러그인이 설치된 적이 없어 그 주석들은 아무 일도 하지 않고 있었다.** 개발자는 규칙이
 *   켜져 있다고 믿고 예외를 선언했고, 실제로는 규칙 자체가 부재했다 — #122가 만든 착시의
 *   가장 선명한 증거다. `reportUnusedDisableDirectives`가 이번에 그것을 드러냈다.
 *
 * ★ `exhaustive-deps`는 warn이다 (의도)
 *   이 규칙은 오탐이 있고(안정 참조를 deps에서 빼는 것이 옳은 경우가 실재한다) error로 두면
 *   CI를 막으려고 disable 주석을 다는 쪽으로 유인이 생긴다 — 위에서 본 그 상태로 되돌아간다.
 *   `rules-of-hooks`는 예외 없이 버그이므로 error다.
 * ══════════════════════════════════════════════════════════════════════════ */

export default [
  ...base,
  {
    files: ['**/*.{ts,tsx,js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
];
