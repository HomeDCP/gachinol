// pnpm 모노레포 + shared 소스 소비를 위한 Metro 설정.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

// 1) 워크스페이스 전체 감시 — packages/shared "소스" 변경이 fast refresh를 탄다.
//    (Expo 기본 watchFolders를 보존한 채 워크스페이스 루트를 추가 — expo-doctor 요건)
config.watchFolders = [...new Set([...(config.watchFolders ?? []), workspaceRoot])];

// 2) 모듈 탐색 경로: 앱 → 루트 순 (pnpm 심링크 대응)
config.resolver.nodeModulesPaths = [
  path.join(projectRoot, 'node_modules'),
  path.join(workspaceRoot, 'node_modules'),
];

// 주의: resolver.disableHierarchicalLookup = true 설정 금지.
// pnpm isolated에서 전이 의존성(node_modules/.pnpm/<pkg>/node_modules/<dep>)은
// 실경로 기준 계층 탐색으로만 풀린다 — 끄면 해석이 깨진다(hoisted 워크스페이스용 처방).

module.exports = config;
