// @ts-check
// 공통 프리셋만 소비한다 — 규칙은 packages/config/eslint/base.mjs가 단일 원천(대장 #122).
// 舊: 이 파일이 tseslint 설정을 직접 들고 있었고 media-worker가 같은 내용을 복제했다.
import base from '@gachinol/config/eslint';

export default base;
