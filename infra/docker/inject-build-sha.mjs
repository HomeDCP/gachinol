#!/usr/bin/env node
/**
 * infra/docker/inject-build-sha.mjs
 *
 * `infra/docker/Dockerfile.web` build 스테이지 전용 후처리기(대장 #186 — 빌드 스탬프).
 * `expo export --platform web`(output: 'static')은 라우트마다 평평한 `<route>.html`을 낸다 —
 * 이 스크립트는 3앱 dist 아래 **모든** `*.html`의 `<head>` 안에
 * `<meta name="build-sha" content="<GIT_SHA>">` 를 주입한다.
 *
 * 사용법: node inject-build-sha.mjs <sha> <dir1> [<dir2> ...]
 *
 * ⚠️ 주입 0건이면 exit 1 한다 — 이 스크립트 하나가 "주입"과 "검증"을 같은 실행(=같은 Dockerfile
 * RUN 레이어) 안에서 함께 한다. 조용히 넘어가면 `verify-deployed-sha.mjs`의 대조가 항상 실패하는데
 * 원인이 여기(주입 누락)라는 게 드러나지 않는다.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

function collectHtmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...collectHtmlFiles(full));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) {
      out.push(full);
    }
  }
  return out;
}

function main() {
  const [sha, ...dirs] = process.argv.slice(2);
  if (!sha || dirs.length === 0) {
    console.error('사용법: node inject-build-sha.mjs <sha> <dir1> [<dir2> ...]');
    process.exit(1);
    return;
  }

  let injected = 0;
  let skipped = 0;
  for (const dir of dirs) {
    const files = collectHtmlFiles(dir);
    for (const file of files) {
      const html = readFileSync(file, 'utf8');
      if (!/<head[^>]*>/i.test(html)) {
        console.error(`⚠ <head> 미검출 — 건너뜀: ${file}`);
        skipped++;
        continue;
      }
      const tag = `<meta name="build-sha" content="${sha}">`;
      const patched = html.replace(/<head([^>]*)>/i, (_m, attrs) => `<head${attrs}>${tag}`);
      writeFileSync(file, patched, 'utf8');
      injected++;
    }
  }

  console.log(`build-sha 주입 완료: ${injected}건 (건너뜀 ${skipped}건, sha=${sha})`);
  if (injected === 0) {
    console.error('FATAL: build-sha 메타 주입 0건 — 배포 후 SHA 대조가 항상 실패한다.');
    process.exit(1);
  }
}

main();
