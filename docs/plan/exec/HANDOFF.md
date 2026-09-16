# HANDOFF — 실행 인계 (기준: 2026-09-16)

> ⭐ **먼저 읽을 것**: [ROOT-CAUSE-2026-08.md](ROOT-CAUSE-2026-08.md) — 이 프로젝트가 정체된 이유의
> 단일 원천이다(2026-08-30~31 전수 정독 결론). **개별 결함이 아니라 그 결함들이 왜 계속 생기는가**를 담는다.
> 이 HANDOFF는 "지금 어디이고 다음 1건이 무엇인가"만 담는다.
>
> **순서는 [QUEUE.md](QUEUE.md)가 단일 원천**이고, **규율은 [DISCIPLINES.md](DISCIPLINES.md)**,
> **AI팀 정의는 `.claude/agents/`**, **개발원칙은 프로젝트 `CLAUDE.md` §0**이다.
> ⚠️ §2(착수 가능 후보 판정)는 **2026-08-30 재판정 시점 값**이며, **2026-08-31 전수 정독으로 순서가
> 바뀌었다** — 착수 판정은 QUEUE.md를 보라. §1은 **2026-08-31 scribe 갱신**으로 재실측을 마쳤다(아래).

> 다음 세션이 **읽고 바로 착수**하기 위한 문서다. 배경·이력은 여기 담지 않는다.
> **이 문서의 모든 수치는 재현 명령을 함께 적는다** — 기록치는 출처가 아니라 검증 대상이다(규율 1).

---

## 0-A. 지금 어디인가 (2026-08-31 · 체제 전환 후)

**2026-08-31에 개발 체제가 바뀌었다.** 사용자 지시로 **개발 착수 전에 근본 해결과 개발원칙 개정**을
먼저 했고, 그 결과 **어제(08-30)의 1순위 판정은 폐기됐다.**

| 무엇이 바뀌었나 | 어디를 보라 |
|---|---|
| 정체의 원인이 확정됐다 — *"검사가 닿지 않는 축에만 결함이 산다"*(여섯 층) | [ROOT-CAUSE-2026-08.md](ROOT-CAUSE-2026-08.md) |
| **순서의 단일 원천이 생겼다** — L0~L5 사전식 사다리 | [QUEUE.md](QUEUE.md) |
| 규율이 개인 메모리에서 리포로 이주했다(19개 + 프로젝트 예외) | [DISCIPLINES.md](DISCIPLINES.md) |
| **조율자 = 관리자, 개발은 서브에이전트** 6롤 | `.claude/agents/` · `CLAUDE.md` §0 |
| 죽은 계획 문서 4개(4,435행)를 아카이브로 옮겼다 | [archive/README.md](archive/README.md) |
| 대장에 **#173~#189(17건)** 채번(2026-08-31 전수 정독분). ⚠️ 이후 같은 날 **#190 추가 채번**(jsDelivr CDN 무조건 로드, scribe 코드 실측) — 이 표는 정독 시점 스냅숏이라 갱신하지 않는다 | `../PIVOT-PLAN.md` §6-11 |

### ⚠️ 어제의 1순위(#168+#170)는 더 이상 1순위가 아니다
전수 정독에서 **그보다 앞서는 결함 4건**이 드러났다 — **#186**(빌드 스탬프 부재: "배포된 것이 어느
커밋인가"를 물을 방법이 없다) · **#187**(Quick Tunnel은 재기동마다 100% 재발) · **#188**(`app/` 라우트가
어느 검사에도 안 걸린다) · **#189**("설정됨"과 "올바름"을 구분하는 층이 없다).
**착수 순서는 반드시 [QUEUE.md](QUEUE.md)로 판정하라.** §2는 08-30 시점 값이라 stale이다(§1은
2026-08-31 scribe가 재실측해 갱신했다 — 아래 §1 참조).

### ⭐ 2026-09-01 — 인터넷 경로가 열렸다 (舊 QUEUE 0-1 완주)
**사용자가 도메인 `bapfull.com`을 구입하고 Cloudflare named tunnel(`bapfull-xeon`)을 개통했다.**
QUEUE 舊 0-1(대장 #179·#187 — 인터넷 경로 502 + Quick Tunnel 재발 구조)이 이것으로 **해소·행 제거**됐다
(scribe 인터넷 경유 재현, 2026-09-01): `curl -s -o /dev/null -w "%{http_code}" https://watch.bapfull.com`
→ **200** · `reporter.bapfull.com`/`center.bapfull.com` → **200** · `api.bapfull.com/health/liveness`
→ **200**. 이 문서의 **"502"·"인터넷 경로 불통"·"Quick Tunnel 재기동마다 재발" 관련 舊 문언은 전부
이 시점부로 stale**이다(아래 §7 함정 절 등에 남아 있어도 **이력**이지 현재 상태가 아니다).
같은 날 `WEB_EXPO_PUBLIC_SUBSCRIBER_WEB_URL` placeholder도 실값(`https://watch.bapfull.com`)으로
교체돼 대장 #172도 해소됐다(`gh variable list` 재확인). **Deploy Web 4잡(build·preflight·deploy·purge)
전부 첫 성공** — purge는 도메인 미확정 상태에서 계속 skip돼 오다 이번이 첫 실행이다(`gh run view
33443330150 --json jobs` 재확인). ⭐ **빌드 스탬프(대장 #186, 어제 신설)가 실사고를 하나 잡았다** —
사용자가 터널을 켜려 제온에서 `docker compose up -d`를 수동 실행하자 web 이미지가 `WEB_IMAGE` 미설정
+ 로컬 태그 폴백(`gachinol-prod-web`) 때문에 **2026-08-21 빌드로 조용히 롤백**됐고, `<meta
name="build-sha">` 대조로 그 사실이 드러났다 — 신규 채번 **대장 #194**. 같은 사고 처리 중 **제온
`~/gachinol`이 git 체크아웃이 아니라 파일 복사본**(리포 수정이 제온에 자동 전달되지 않음)임도
드러나 **대장 #195**로 채번했다. 상세는 PIVOT-PLAN §6-11 #194·#195, 오늘 일간보고서.

### ⭐ 2026-09-02 — #189 종료 (PR #87 머지)
**QUEUE 舊 0-1(대장 #189 — URL 형태 검증)이 해소돼 행이 제거됐다**(main 머지커밋 `3f8e873`, 구현 커밋
`da9e22f`). `infra/scripts/bundle-budget.mjs`에 `--check-urls` 모드가 신설됐고(`checkUrls()` — `new URL()`
파싱 앞에 `<`/`>` 문자 검사를 둔다. 이유는 실측: `new URL()`은 host 위치 placeholder만 스스로 던지고
path/query/fragment 위치는 퍼센트인코딩돼 파싱만으로는 조용히 통과한다), `.github/workflows/deploy-web.yml`
110~120행에 웹 빌드 스텝(124행)보다 앞서 배선됐다. 재현: `grep -c "new URL" infra/scripts/bundle-budget.mjs`
→ **5**(scribe 재확인) · `node infra/scripts/bundle-budget.test.mjs` → **15/15 pass**. 상세는 PIVOT-PLAN
대장 #189 행.
⚠️ **같은 종료 기록 중 후속 결함 1건을 신규 채번했다(대장 #198, 미수신)** — `apps/*/src/config/env.ts`의
`getApiBaseUrl()`에 `.trim()`이 없어(3앱 동일 코드) 공백만 있는 값이 truthy로 그대로 API 베이스 URL이
된다. #189의 CI 검증은 **배포 단계(Actions vars)만** 막고 **앱 코드 자체는 그대로**라 별개 결함이다.
상세는 PIVOT-PLAN 대장 #198 행(우선순위·조치 방식은 조율자 판정 대기).

### ⭐ 2026-09-02 — 배포 슬라이스 종료 (0단계 완주)

**사용자가 `DROP COLUMN` 마이그레이션 적용을 승인했고, 조율자가 SSH로 제온 백엔드 풀스택을
실배포했다.** 명령: `cd ~/gachinol/infra/docker && docker compose -f docker-compose.prod.yml -f
docker-compose.xeon.yml pull api ai-worker media-worker && docker compose -f docker-compose.prod.yml
-f docker-compose.xeon.yml up -d --no-build api ai-worker media-worker`. 조율자 실측 인용(scribe는
제온 SSH 금지라 재현 불가): api·ai-worker·media-worker 이미지 전부 `2026-09-01T21:0x:xxZ`로 갱신,
`/health/version` 404→200, `minor_consent_*` 컬럼 2→0, `_prisma_migrations` 11→12건. `DROP COLUMN`은
별도 명령이 아니라 api 엔트리포인트의 `RUN_MIGRATIONS:-true`가 부팅 전 자동 실행했다. 적용 전
손실 실측(조율자 인용): `contents` 11행 중 두 컬럼 NOT NULL 0건(2회 재확인) — 잃은 데이터 0건.
복원점 `gachinol-20260902-040924.sql.gz`(gzip 무결성 통과).
**scribe 독립 재현**(인터넷 경로, SSH 아님, 2026-09-02): `curl -s https://api.bapfull.com/v1/health/version`
→ `{"sha":"3f8e87316d991576c13e91570e90ffa9077eaa95"}`(로컬 `git fetch origin main && git log --oneline
-1 origin/main` 최상단 `3f8e873`과 SHA 접두 일치 — 배포본이 main HEAD와 같다).
→ **대장 #170 해소, QUEUE 0단계 표가 완전히 비어 0단계가 완주됐다**(QUEUE §0단계 참조).

같은 날 커밋 `0fc1949`가 **대장 #194**(web 이미지 로컬 태그 폴백 — 사용자가 실제로 이 사고를
밟았다) · **대장 #195**(제온 손편집 cloudflared 활성화가 리포에 역동기화되지 않음)를 함께 닫았다.
⚠️ #195는 **그날 실제로 밟은 증상(손편집 미동기)만** 닫혔다 — "api·media-worker·ai-worker를 SSH로
pull·up하는 배포 잡 자체가 없다"는 구조적 잔여는 이미 **QUEUE 1-1(대장 #180)로 범위가 좁혀져** 그쪽이
이어받는다. QUEUE 2-6(#194)의 舊 처방 문언(`WEB_IMAGE` 참조 자체를 없애는 단순 대체안)은 **부정확**했다
— 실제 구현은 중첩 폴백(`WEB_IMAGE` 참조 유지 + GHCR 한정)이었다(규율 13, QUEUE 2단계 절 참조).

또 커밋 `a8963e8`·`fd872d1`이 `/health/version`이 전역 prefix(`/v1`)를 안 타 404였던 결함을 닫았고
(smoke e2e를 CI에 편입, run `33563266139`에서 `PASS test/smoke.e2e-spec.ts` 실통과 확인), 검증
뮤테이션이 위임문 전제(`/v1` 404 단언)를 반증해 주석을 정정했다(`fd872d1`).

**PR #88**(문서, 대장 #189 종료+#198 채번, node·ai-worker 2잡)·**PR #89**(배포 묶음, node·ai-worker·
build api·build media-worker·build ai-worker 5잡)는 **둘 다 CI 전부 success — 머지 대기**다. scribe
재확인(2026-09-02): `gh pr view 89 --json statusCheckRollup` 첫 조회 시점엔 `build api`가
`in_progress`였으나(값을 그 자리에서 못 믿을 뻔한 사례) 재조회하니 5잡 전부 `SUCCESS`,
`gh pr view 89 --json mergeable,mergeStateStatus` → `MERGEABLE`/`CLEAN`. **#89는 #88 위에 쌓여 있어
#88을 먼저 머지해야 한다.**

### ⭐ 2026-09-03 — QUEUE 1-1(舊, 대장 #180) 완주 + 신규 결함 실발생·당일 해소(대장 #200)

**PR #91**(경로 신설 + 규율 2 기계화, 커밋 `76014bc`+`f95a9ee`, 병합 `5a5d56e` · 2026-09-02T15:12:48Z)이
`.github/workflows/build-images.yml`에 api·media-worker·ai-worker deploy 잡을 신설했다(web 잡 패턴
복제 — `pull && up -d --no-build`+SHA 대조). **병합 직후 첫 실배포(15:17~15:20)가 즉시 새 결함을
드러냈다**: `docker compose up -d <service>`는 `--no-deps` 없이는 의존 서비스도 함께 처리하는데,
`deploy-web.yml`이 `up -d --no-build web`을 돌리자 `depends_on: api`인 api까지 함께 평가돼 **api가
`${IMAGE_TAG:-latest}`(제온 캐시된 옛 이미지)로 되돌아갔다**(신규 채번 **대장 #200**). SHA 대조는
15:18에 정확히 통과했었다 — 2분 뒤 다른 워크플로가 덮었을 뿐이다. **같은 날 PR #92**(커밋 `63b7a05`,
병합 `6651666` · 2026-09-03T04:59:44Z)로 두 워크플로의 `up`에 `--no-deps`를 대칭 적용해 수리했다.

**최종 실배포 확인(2026-09-03, scribe 재현)**: `curl -s https://api.bapfull.com/health/version` →
`{"sha":"665166691ae0d998e82f841978f1f7cb186d60d2"}`(舊 404). CI 잡 단위(`gh run view 33717077694
--json jobs`): preflight✅·build api/media-worker/ai-worker✅·**deploy✅**(로그 원문 `SHA 일치
확인(kind=api): 6651666...`·`(media-worker): 6651666...`·`(ai-worker): 6651666...`). **승인 게이트
실동작**: build 종료 `05:02` → deploy 시작 `05:41`(약 39분 대기 — required reviewer 승인 두 건을
오늘 각각 통과했다, build-images·deploy-web 워크플로 별도). 제온 컨테이너가 `latest`가 아니라
커밋 SHA 태그로 뜬 것은 **조율자 실측 인용**(scribe SSH 금지, curl 재현분만 독자 확인).

→ **QUEUE 1-1(대장 #180) 해소·행 제거, 번호가 당겨져 舊 1-2(배포 후 스모크)가 새 1-1로, 舊
1-3(가용성 감시)이 새 1-2로 바뀌었다.** 상세는 PIVOT-PLAN 대장 #180·#200, QUEUE 1단계.

### ⭐ 2026-09-05 — QUEUE 舊 1-1(대장 #180) 잔여분 완주(PR #94) + 대장 #202 채번 + 판정은 다음 세션으로

**PR #94**(브랜치 `feat/deploy-smoke-migration-gate`, 병합 `1776c461` · 2026-09-05T01:28:57Z)가 대장
#180이 갖고 있던 처방 3개 중 미이행 2개를 닫았다 — ② 배포 후 라우트 스모크(`infra/scripts/deploy-smoke.mjs`,
미인증 요청의 `≠404`를 실재 판정으로 삼음, 없는 경로 음성 대조 필수) · ③ 파괴적 마이그레이션 사전
승인 게이트(`infra/scripts/check-destructive-migrations.mjs`, 사용자 채택 ⓐ안 — red로 세우고 승인
마커로 해제). **게이트②가 자기 검증에서 한 번 반려당했다** — 승인 마커 필수 칸에 `-`·`n/a`·같은
글자 반복을 넣어도 통과하던 구멍("있는 척"을 막던 장치가 스스로 "있는 척"을 함)을 같은 PR에서
수리했다(도메인 신호=수치+단위/백업 파일 식별자 요구로 교체). 상세는 PR #94 본문·PIVOT-PLAN 대장
#180 정정 블록이 정본.

**머지 후 실배포까지 확인 완료**(scribe 재현, 2026-09-05): `gh run list --branch main --json
workflowName,conclusion,status,headSha -L 3`에서 CI·Build Images·Deploy Web **3종 전부
success**(headSha가 main HEAD와 일치하는지가 판정 기준 — 아래 §1 재현 명령 참조) ·
`curl -s https://api.bapfull.com/health/version`의 `sha`와 `curl -s https://watch.bapfull.com | grep
-o '<meta name="build-sha"[^>]*>'`의 `content`가 서로 일치하고 그 값이 `git log --oneline -1
origin/main`과 일치 · 스모크 판정 라우트 3종(`/v1/resident-uploads/<uuid>`→401·`/v1/feed`→200·
없는 경로→404)이 실물에서 재현됨. **승인 게이트가 배포마다 실제로 걸린다** — 이번에도 build 종료와
deploy 시작 사이 약 53~54분 대기가 있었다(§1 재현 명령의 `gh run view <run-id> --json jobs`로 매번
확인할 것). 상세는 오늘 일간보고서(`docs/ops/daily/2026-09-05.md`) ①·②·④.

**같은 날 대장 #202 채번 — 배포 승인이 구조적으로 2회다.** 발견 경로는 사용자 질문(*"승인버튼 한 번
눌러서 빌드이미지·디플로이 웹 두 가지를 한 번에 승인할 수는 없을까?"*). 실측: `build-images.yml`·
`deploy-web.yml`이 같은 `production` 환경을 쓰는 **서로 다른 워크플로 런**이라 승인 창이 각각
뜬다(한 번에 승인하는 UI 없음) — 하나의 논리적 배포를 두 워크플로로 쪼갠 구조 자체가 원인이며,
**#200(증상 — `up`이 의존 서비스를 함께 처리해 되돌림, `--no-deps`로 해소됨)과는 다른 결함**이다
(#200=이미 해소된 증상 / #202=그 증상을 낳은 구조, 미해소). 상세는 PIVOT-PLAN 대장 #202 행.

**QUEUE 1단계 번호도 당겨졌다** — 舊 1-1(배포 후 스모크)이 해소·제거되며 舊 1-2(가용성 감시 신설)가
새 1-1이 됐다. ⚠️ **이 새 1-1은 아직 미채번**이다(QUEUE 1단계 표 ID 칸이 `(미채번)`) — 규율 24-1에
따라 착수 전 채번이 선행이다.

### ⭐ 다음 세션이 판정할 질문(사용자 지시, 2026-09-05) — 이 HANDOFF의 핵심

**QUEUE 새 1-1(가용성 감시 신설, 미채번)과 대장 #202(배포 승인 2회 구조)를 묶어서 갈지, 따로 갈지를
다음 세션이 판정한다.** scribe는 판정하지 않는다 — 아래는 판정 재료의 소재지다(값이 아니라 "어디를
보라"는 지시).

- 두 건 모두 **배포 신뢰성 층**이라는 점에서 같다. 새 1-1 = "배포 이후의 이탈을 지속 감시" · #202 =
  "배포 경로 자체가 워크플로 둘로 쪼개진 구조". "같은 층"이라는 사실이 **묶어야 한다는 결론을 자동으로
  주지는 않는다**.
- 사다리 판정 근거가 갈린다: 새 1-1은 QUEUE 1단계 표에 **L1**로 이미 기재돼 있고(`grep -n "^| 1-1 "
  docs/plan/exec/QUEUE.md`), #202는 조율자가 **L2 성격**으로 잠정 표기했다(대장 #202 행 마지막 칸
  "조율자 잠정 사다리 판정: L2"). 사전식 사다리는 L1이 L2보다 앞이므로 **단순 순서로는 새 1-1이
  먼저**다.
- QUEUE에는 "검사 축 확장은 순서가 아니라 동반 의무(D1)로 처리한다"는 선례가 이미 있다(규율 문서
  참조) — #202를 새 1-1의 **동반 의무**로 묶을지, 독립 항목으로 별도 채번·별도 순번을 매길지가
  판정의 실질 내용이다.
- 확인할 것 하나: **#202를 먼저 수리하면(두 워크플로를 합치거나 workflow_call로 통합) main 배포
  런이 하나로 합쳐진다.** 그러면 새 1-1(가용성 감시)이 감시할 대상의 형태(배포 신선도를 무엇으로
  잴 것인가 — 런 1개 기준인지 서비스별 SHA 대조 기준인지)도 함께 바뀌는가? 바뀐다면 그것이 순서를
  뒤집을 근거가 되는지(먼저 구조를 고치고 그 위에 감시를 얹는 편이 재작업을 줄이는지) 이 세션에서
  실측 없이 판정하지 말고 위 소재만 남긴다.
- 재현 명령: `awk '/branches: \[main\]/{a[FILENAME]=1} /environment: production/{b[FILENAME]=1}
  END{for(f in a) if(f in b) c++} END{print c+0}' .github/workflows/*.yml`(대장 #202가 "2"로 등재한
  구조 판정 명령 — 통합 후 "1"이 기대값) · `grep -n "^| 1-1 " docs/plan/exec/QUEUE.md`(새 1-1 현재
  기재 상태) · `grep -n "^| 202 " docs/plan/PIVOT-PLAN.md`(#202 전문).

> ⭐ **해소(2026-09-06)** — 다음 세션이 아니라 계획 수립으로 판정됐다. 조율자가
> `~/Claude/plans/transient-cuddling-scroll.md`(리포 밖, PR #96 브랜치에 커밋 예정)를 승인했고 결론은
> **묶지 않는다**였다: 새 1-1(가용성 감시)은 **대장 #203**으로 채번해 1단계 그대로 진행하고, #202
> (배포 승인 구조 2회)는 **별도로 존치**한다(계획 §4-6 "이번에 하지 않는 것" — "두 워크플로 통합은
> report-only 종료 후 별도 슬라이스"). 이유: #202를 먼저 풀면 새 1-1이 감시할 대상의 형태가 바뀔 수
> 있다는 위 우려(줄 172-176)를 계획이 설계로 반박했다 — 새 1-1의 판정 로직(`monitor.yml`)은 기존
> `verify-deployed-sha.mjs`·`deploy-smoke.mjs`를 그대로 재사용하도록 설계돼 워크플로 개수와 무관하다
> (계획 §4-2 S3 상세). 상세는 아래 새 절.

### ⭐ 2026-09-06 — 감시체계 재설계 계획 승인 + 대장 #203·#204·#205 채번 (S0, PR #96)

**조율자가 계획 문서(`~/Claude/plans/transient-cuddling-scroll.md`, 리포 밖)를 승인했다** — 결론:
감시는 축마다 지점이 다르다(① 도달성=집 밖 프로브 · ②③④ 배포 신선도/의도 vs 실물=GitHub Actions
cron·승인 게이트 밖 · ⑤ 감시 자신의 생존=GitHub 밖 하트비트 수신기). 슬라이스 S0~S5로 쪼갰고,
**S0(코드 0줄, 채번·편입만)**을 scribe가 이번에 반영했다: 대장 **#203**(시간축 관측 0 — 배포 이후
아무도 지속 확인하지 않는다) · **#204**(`deploy-smoke.mjs`가 5xx를 통과시킨다) · **#205**(제온 안에서만
보이는 축이 밖으로 보고 안 됨, 2단계 — 규율 24-1로 지금 채번). QUEUE 1단계 1-1의 `(미채번)` →
`대장 #203`(동반 의무 `#204` 같은 슬라이스), §C에 사용자 실행 C-4(Healthchecks.io)·C-5(외부 프로브)
신설.

**scribe가 그 자리에서 재확인(2026-09-06, 계획 §1-0과 동일 명령을 하루 뒤 재실행)**: `git fetch
origin main --quiet && git rev-parse --short origin/main` → **`9d2a9d8`**(어제와 동일 — main이 하루째
정지) vs `curl -s https://api.bapfull.com/health/version` → **`1776c46...`**(서빙 SHA 불일치 지속) ·
`gh api "repos/HomeDCP/gachinol/actions/runs?status=waiting" --jq '.workflow_runs[].html_url'` →
`https://github.com/HomeDCP/gachinol/actions/runs/33964788538`(Build Images)·
`https://github.com/HomeDCP/gachinol/actions/runs/33964788536`(Deploy Web) — 둘 다
`2026-09-05T11:59:40Z` 생성 그대로 **여전히 대기 중**(만 하루 경과, 오늘 일간보고서 ① 참조) · 대장
#204 재현 명령을 그 자리에서 실행 → **`exit=0`**(`/health/version` 500 픽스처인데도 `판정: PASS` —
결함 실재 확인, 대장 #204 행에 명령·출력 동봉).

상세는 오늘 일간보고서(`docs/ops/daily/2026-09-06.md`) ①·②.

### ⭐ 2026-09-10 — 데드맨 실증 확인(대장 #203 ⓑ) + 3일간 상태 무변화 확인 (scribe, PR #96 머지 전)

**PR #96(HEAD `c57f92a`)에 S1·S2·S3가 전부 실려 머지 대기 중이던 사흘(2026-09-07 08:44 KST~09-09)
동안, 이 리포에는 아무 변동이 없었다** — origin/main **`9d2a9d8`** 불변(2026-09-05 20:59 KST 머지
이후 5일째, `git log -1 --format=%ad --date=format:'%Y-%m-%d %H:%M %z' 9d2a9d8`) · PR #96 활동은
`c57f92a` 커밋 시각(2026-09-07 08:44 KST, `gh pr view 96 --json updatedAt`과 일치) 이후 정지 ·
대기 중인 승인 게이트 런 **0건**(`gh api "repos/HomeDCP/gachinol/actions/runs?status=waiting"
--jq '.workflow_runs|length'`). 그 사이 **리포 밖에서 실물 사건이 하나 있었다**: 사용자가
2026-09-07 Healthchecks.io 텔레그램을 연결(06:01 AM)하고 수동으로 첫 ping을 보낸 뒤(06:49경),
**DOWN 알림이 07:34 AM에 도착**했다(period 15분+grace 30분 = 정확히 45분 후 발화, `Total Pings: 1`·
`All the other checks are up` 둘 다 설계대로) — 대장 #203의 확인 방법 두 건 중 **ⓑ("주기 신호
부재를 감시 밖 수신기가 인시던트로 만든 기록")가 이걸로 충족됐다**. **ⓐ(집 밖 관측점의 실패 알림
도달)는 인터넷 경로가 계속 정상(200)이라 아직 미충족** — S4의 의도적 장애 뮤테이션을 거쳐야 한다.
**대장 #203 상태 칸은 "미수신"으로 유지한다** — 머지 전이고, 확인 방법 두 건 중 하나만 찼다.
같은 세션에서 QUEUE §C의 **C-4를 완료로 갱신**(`gh secret list --repo HomeDCP/gachinol --json name
--jq 'length'` → 9건, `MONITOR_HEARTBEAT_URL` 포함)하고 **C-5는 "개설 완료·실패 도달 미확인"으로
구분 갱신**했다(완료로 뭉뚱그리지 않음). 상세는 대장 #203 비고(`docs/plan/PIVOT-PLAN.md`), 오늘
일간보고서(`docs/ops/daily/2026-09-10.md`) ①·②·④.

### ⭐ 2026-09-10(PR #96 머지 후, 같은 날 후속) — 감시가 실가동 첫날 자기 전제를 반증했다 (scribe, PR #97)

**이 절은 위 "PR #96 머지 전" 절 뒤에 이어지는 후속 기록이다(규율 13 — 원문 보존, 위는 지우지 않음).**
PR #96이 머지되고(`32ff7ec`) 배포가 정상화된 뒤, `monitor.yml`이 처음 실가동에 들어가자마자 자기
전제를 스스로 반증했고 데드맨이 그 공백을 4회 전부 잡았다.

선언 주기(`cron: '7,22,37,52 * * * *'` = 15분, `grep -n "cron:" .github/workflows/monitor.yml`)와
달리 실측 스케줄 런 간격은 1.34h·2.02h·5.20h였다 — 재현: `gh run list --workflow monitor.yml --limit
30 --json event,createdAt --jq '.[] | select(.event=="schedule" or .event=="workflow_dispatch") |
.createdAt' | sort` → scribe 재실행(2026-09-10) 4건: `2026-09-09T22:03:36Z`(workflow_dispatch·조율자
수동)·`2026-09-09T23:24:05Z`·`2026-09-10T01:25:04Z`·`2026-09-10T06:37:00Z`, 전부 `conclusion=success`.
**옛 Healthchecks 문턱(45분 = period 15분+grace 30분)을 세 공백 전부와, 06:37 이후 진행 중인 네 번째
공백(scribe 재확인 4.05h, 2026-09-10T10:39:55Z 기준·신규 런 없음)도 넘겨 매번 DOWN을 발화시켰다** —
사용자 확인(2026-09-10): *"4시 22분까지 다운 알림이 4번 왔다"*(공백 4개와 정확히 1:1 대응, 하나도
놓치지 않았다). **판정 로직 자체는 3건 전부 `PASS`로 정상이었다** — 고장 난 것은 주기 전제였다.

**우리가 만든 두 층 중 ①(감시)이 고장 났고 ⑤(데드맨)가 그것을 잡았다** — 계획 원칙 3(*"데드맨이
완료 조건 — 순서를 바꾸면 #72를 재생산한다"*, 조율자 인용·scribe는 계획 문서 미접근)의 순서(⑤ 수신기
선가동 확인 → S3 `monitor.yml` 머지)를 지킨 것이 이 차이를 만들었다. ⑤를 나중으로 미뤘다면
`gh workflow list`엔 `active`, 개별 런은 `PASS`로만 보이니 이론 대비 8.3%만 도는 상태를 초록으로
보며 몇 주를 보냈을 것이다. 상세·전체 재현·Healthchecks 재설정값은 대장 #203 비고(`docs/plan/PIVOT-PLAN.md`)와
QUEUE.md §C C-4가 정본.

**PR #97**(`fix/monitor-schedule-reality`, 커밋 `c49499a`) — `monitor.yml`·`monitor-freshness.mjs`
주석을 이 실측에 맞게 정정(cron 값·STALE_HOURS·판정 로직·`test:scripts` 341→341 전부 불변, 주석만).
`gh pr view 97 --json state,mergeable` → `OPEN`/`MERGEABLE`, 체크 3종 전부 `SUCCESS`.
**Healthchecks.io 재설정(사용자 실행, 2026-09-10)** — `gachinol-monitor` 체크 period 15분→**1시간**·
grace 30분→**6시간**(SaaS 대시보드값, 리포 명령 재현 불가 — ⓗ 명시적 수동). **첫날 3건 표본 기반
임시 하한이며 최종값이 아니다**(2주 report-only에서 재조정).

⚠️ **확인 방법 ⓐ는 PR #96 머지 이후에도 여전히 미충족** — `watch.`·`reporter.`·`center.bapfull.com`·
`api.bapfull.com/health/readiness` 전부 scribe 재확인(2026-09-10T10:43:31Z) **200**. 인터넷 경로가
실패한 적이 없어 외부 프로브(C-5)가 잡을 사건 자체가 없다 — S4(의도적 장애 뮤테이션)가 필요하며,
PR #96이 아니라 **PR #97 머지 이후**로 순서가 밀렸다(PR #96 머지 직후 주기 반증이 드러나 그 수리가
S4보다 먼저 끼어들었다).

⚠️ **정정(조율자 실수, 규율 13 기록)**: 이 세션 위임문이 Healthchecks 설정값 원천으로
`docs/infrastructure.md` §4-D를 지목했으나 그 절은 실재하지 않는다(scribe 재확인: `grep -n "^#"
docs/infrastructure.md`에 "감시"·"Healthchecks"·"monitor" 관련 표제 0건). 실제 원천은 QUEUE.md
§C C-4이며, 같은 정정이 `monitor.yml` 커밋(`c49499a`) 주석에도 이미 반영돼 있다.

### ⭐ 2026-09-11 — 대장 #203 해소 + QUEUE 1단계 완주 (scribe, PR #98)

**PR #97은 이미 머지돼 있었다**(`e0e65d4`, `mergedAt: 2026-09-10T11:12:59Z` — `gh pr view 97 --json
mergedAt,mergeCommit` 재확인). 이 세션이 시작한 브랜치(`docs/monitor-203-closeout`)의 base가 이미
그 머지커밋이다. 이 세션이 한 일은 새 코드가 아니라, **사용자가 그다음 실행한 확인 방법 ⓐ를
정본에 반영**하는 것이었다.

**확인 방법 ⓐ 실증(사용자 실행, 2026-09-10)** — Better Stack에 존재하지 않는 URL
(`https://api.bapfull.com/__monitor_test_404__`, scribe 재확인: `curl -s -o /dev/null -w
"%{http_code}" https://api.bapfull.com/__monitor_test_404__` → **404**)로 3분 주기 임시 모니터를
만들어 **알림 수신을 확인한 뒤 즉시 삭제**했다(사용자 보고 원문: *"알림 왔다 확인 후 삭제도
했다"*). 채널은 텔레그램이 아니라 **Better Stack 앱 푸시·이메일**이었다(Better Stack은 텔레그램을
지원하지 않는다 — scribe 재확인: `curl -s -o /dev/null -w "%{http_code}" -L
https://betterstack.com/docs/uptime/integrations/telegram` → **404**). ⓐ가 요구한 것은 "실패가
운영자 휴대폰에 도달"이므로 채널이 ⓑ(텔레그램)와 달라도 충족이다.

**결과 — 대장 #203 해소, QUEUE 1단계 완주.** 확인 방법 ⓐⓑ가 모두 채워져 결함 본문 세 축(인터넷
도달성·배포 신선도·api readiness를 묻는 주체)이 전부 채워졌다고 보아 상태 칸을 해소로 바꿨다
(`docs/plan/PIVOT-PLAN.md` 대장 #203). QUEUE 1단계(`docs/plan/exec/QUEUE.md`)의 유일하게 남아 있던
행(1-1)이 이것으로 제거돼 **1단계 자체가 완주**됐다 — 다음 착수 후보는 2단계 2-1(대장 #173·#188,
순서는 QUEUE.md가 이미 정한 것으로 이 세션이 바꾸지 않았다).

⚠️ **해소되지 않은 것(지우지 않고 남긴다)**: ① **선언(15분 cron)과 실제(평균 3.31h) 사이 괴리는
그대로다** — 닫힌 것은 "묻는 주체가 없다"이지 "주기가 선언대로 돈다"가 아니다. scribe 재실행
(2026-09-10T22:26:48Z): `gh run list --branch main --workflow monitor.yml --limit 60 --json
event,createdAt,conclusion --jq '.[] | select(.event=="schedule" or .event=="workflow_dispatch") |
[.createdAt,.event,.conclusion] | @tsv' | sort` → 간격 7개 최소 1.34h·최대 5.21h·평균 3.31h(7h
허용치 대비 여유 1.79h, 설정 변경 이후 3개 간격 3.59h·3.25h·2.56h 전부 허용치 안·추세는 짧아지는
중). ② **현재 임계(period 1h·grace 6h)는 첫날 3건 표본 기반 임시값**이다 — 여유가 1.79h뿐이라 6h
넘는 공백이 한 번이라도 나오면 오탐이 재개된다.

변경 파일(scribe 소관, git 쓰기 없음 — 커밋·PR은 조율자 몫): `docs/plan/PIVOT-PLAN.md`(대장 #203
상태 칸+비고) · `docs/plan/exec/QUEUE.md`(1-1 행 제거+완주 서술·§C C-4·C-5) ·
`docs/ops/daily/2026-09-11.md`(신규) · 이 문서(HANDOFF.md).

**머지 완료(2026-09-11T07:52:33Z UTC, 병합커밋 `7088dbe`)** — 위 변경 전부 지금 origin/main에 있다.
이 시각이 아래 "2주 report-only 관측"의 기산일이다.

### ⭐ 2026-09-11 — STT 로컬 전환 정본 정합 완료 (scribe, QUEUE 3-3 → 대장 #207, PR #99)

**이 세션은 위 PR #98 세션과 별개 브랜치(`fix/reporter-capture-stt-canon`, 이 브랜치)에서, PR #98이
아직 열려 있던 시점(작성 10:12 KST, PR #98 머지는 16:52 KST)에 독립적으로 진행됐다** — 그래서 이
문서와 오늘 일간보고서 양쪽에서 PR #98과 충돌이 났고(2026-09-11, 조율자가 `git merge origin/main`
실행 중 발견), scribe가 이 절을 포함해 마커를 제거하고 통합했다(양쪽 내용 보존, 규율 13).

QUEUE.md 3-3(舊 "(미채번)")이 예고했던 **STT 로컬 전환 미반영**을 처리했다 — 2026-08-20 사용자 결정
(로컬 whisper.cpp+Silero VAD, 근거는 비용이 아니라 데이터 주권, `CLAUDE.md:499-503`)이 정본 문서에
반영되지 않아 **07 §3-10(개인정보 국외이전) 법률자문 질의서가 舊 RTZR 전제로 나갈 뻔했다.**

**대장 #207 채번**(PIVOT-PLAN.md §6-11) + **7개 파일 24건 동시 정정**(scribe가 같은 세션에서 즉시
수행): `docs/plan/01-product-strategy.md`(2)·`02-web-architecture.md`(1)·`03-accessibility-ux.md`(5)·
`05-monetization.md`(2)·`07-legal-license.md`(6)·`08-rollout-transition.md`(3)·`docs/infrastructure.md`(5).
전부 **삭제가 아니라 이력 보존**(규율 13) — "舊 RTZR → 로컬 whisper.cpp+Silero VAD(2026-08-20, 근거:
데이터 주권)" 형태로 바꿨다. 07 §3-10은 STT 국외이전 축만 소멸시켰고 R2·Cloudflare Stream·OpenAI
축·아동 동의(§3-3)·초상권(§3-6)은 무변경 — "자문 불요"로 적지 않았다. 05 §B-1 비용표는 새 수치를
만들지 않고 "재산정 필요(미실측)"로만 표기했다.

⚠️ **위임문 자체의 인용 오류 2건을 scribe가 이 채번에서 잡았다**(대장 #207 발주처 칸에 근거 동봉) —
① 위임문은 "정본 6곳·19건"이라 적었으나 파일별 `grep -c "RTZR"` 재실행은 **7개 파일 24건**이었다
(`docs/infrastructure.md`가 PIVOT-PLAN 번호 정본 밖이라 누락돼 있었다) ② 위임문은 "자문 회신 2~4주
리드타임(QUEUE §B B-2)"이라 인용했으나 QUEUE.md §B B-2 행의 "리드타임" 칸은 **"미기재"**다 — 2~4주는
§B **B-3**(웹접근성 법정의무 판정, 별개 주제)의 수치였다.

**대장 #207 상태는 "미수신"으로 유지한다** — scribe는 문구를 고쳤을 뿐 07 §3-10·§4·§6의 법률적
정확성을 판정할 권한이 없다. 해소 전환은 조율자·외부 법률자문 검토 몫이다(아래 "열린 항목" 참조).
QUEUE.md 3-3의 ID 칸도 `대장 #207`로 갱신했다. **git 커밋 없음**(scribe는 git 쓰기 금지 — 위 변경은
전부 워킹 트리에 미커밋 상태로 남아 있다). ⚠️ 이 작업은 QUEUE **3단계(정본 재정합)** 항목이라 사다리
순서상 1단계보다 뒤다 — **PR #98 세션 관점에서는 "실제 다음 1건은 여전히 아래 '⭐ 지금의 다음 1건
(2026-09-10 PR #97 세션 갱신)' 절(PR #97 머지 → S4)"이었으나, PR #98이 그사이 머지되며 그 절 자체가
아래 "舊 다음 1건"으로 대체되고 새 "지금의 다음 1건(2026-09-11 scribe 갱신)"이 생겼다** — 이 STT
작업이 그 우선순위를 바꾸지는 않는다(여전히 3단계). 같은 세션에서 `apps/reporter/**`(촬영 캡처)를
동시에 고치던 별도 구현 세션(2-1, 대장 #173·#188)이 있었으나 **scribe는 그 경로를 건드리지
않았다**(`git status --short`로 구분 가능 — scribe 변경은 `docs/**`뿐).

**PR #99로 열림(`fix/reporter-capture-stt-canon` → main), 2-1과 함께 실려 아직 머지 대기.** 게이트②
(독립 검증)가 뒤이어 이 작업의 방법론 빈틈(05-monetization.md:274 미정정) 1건을 잡아 같은 세션에서
수리했다 — 상세는 오늘 일간보고서 ②·③ 참조(대장 #208·#209 채번도 같은 흐름).

### 다음 1건(舊 표기 — 위 판정 질문으로 대체됨, 규율 13 이력 보존)
~~**QUEUE 1-1(새 번호) · 대장 #180 소유 — 배포 후 스모크**~~는 2026-09-05 PR #94로 해소·행 제거됐다
(위 참조). 이 자리에 있던 舊 문언은 이력으로만 남긴다(규율 13): *"배포 직후 검증은 그 순간의 참만
재고 그 이후 다른 프로세스가 되돌리는 것을 원리적으로 못 잡는다 — 스모크만으로 '재발 방지 완결'이라
보고하지 말 것."* 이 한계가 바로 위 판정 질문에서 새 1-1(가용성 감시)의 존재 이유다.

### 舊 다음 1건 (2026-09-10 오전 갱신 — PR #96 머지 후 첫 스케줄 런의 발견으로 아래 절에 대체됨, 규율 13 이력 보존)

**S1·S2·S3는 전부 끝났다 — 남아 있던 것은 머지뿐이다.** 계획 §4-2 순서(S0→S1→S2→S3→S4)대로 이
세션 전에 이미 S1·S2·S3가 완료돼 PR #96(브랜치 `fix/station-gate-upload-atomicity`, HEAD
`c57f92a`)에 실려 있다 — 아래 세 항목은 **다시 만들지 말 것**:

1. **S1 완료** — `deploy-smoke.mjs` 5xx 실패 처리(대장 #204, 커밋 `5204348`). 舊 "착수 전 재확인"
   지시는 이걸로 소화됐다.
2. **S2 완료(사용자 실행)** — C-4(Healthchecks 계정·체크·텔레그램·시크릿)는 사용자 실측(2026-09-07
   텔레그램 스크린샷, DOWN 알림 07:34 AM)으로 확인됐다. `gh secret list --repo HomeDCP/gachinol
   --json name --jq 'length'` → **9**건(`MONITOR_HEARTBEAT_URL` 포함, 값은 안 보임). C-5(외부
   프로브)는 **개설 완료·실패 도달은 아직 미확인**(S4에서 의도적 뮤테이션으로 확인 예정). 상세는
   [QUEUE.md](QUEUE.md) §C·PIVOT-PLAN 대장 #203 비고.
3. **S3 완료** — `monitor.yml` 신설(커밋 `c57f92a`). `environment:`를 선언하지 않아 대장 #202의
   승인 게이트를 타지 않는다(커밋 본문에 근거 명시).

**다음 1건은 코드가 아니라 머지다**:

1. **PR #96 머지 승인**(사용자, CLAUDE.md §0-3 ⑩ — 예외 없음). `gh pr view 96 --json
   state,mergeable` → `OPEN`/`MERGEABLE`(이 문서 기준일 시점, 재확인할 것). 머지 후 배포 승인
   **2건**이 또 뜬다(대장 #202 미해소 — Build Images·Deploy Web 각각 `production` 환경 승인,
   `monitor.yml` 자체는 이 게이트 밖).
2. **머지 후 첫 스케줄 런 확인** — `gh run list --workflow monitor.yml -L 3`. `monitor.yml`은
   승인 없이 15분 주기로 자동 실행되므로, 첫 런이 실제로 도는지·판정이 PASS인지를 이 명령으로
   확인한다(대장 #203의 ②③④ 축이 실물로 도는 첫 순간).
3. **확인되면 S4(2주 report-only 관찰) 착수** — 계획 §4-2. 그 전엔 착수하지 않는다.

가변 값(정확한 승인 시각·첫 스케줄 런 결과)은 여기 적지 않는다 — 위 확인 명령으로 그 자리에서 잰다.
**⚠️ 이 절 전체가 이제 舊 표기다(헤더 참조)** — 실행해 보니 "첫 스케줄 런 확인"이 단순 확인으로
끝나지 않고 주기 전제 반증(위 "2026-09-10(PR #96 머지 후)" 절)을 낳아 아래 절로 대체됐다.

### 舊 다음 1건 (2026-09-10 PR #97 세션 갱신 — PR #97 머지·확인 방법 ⓐ 실증 완료로 아래 절에 대체됨, 규율 13 이력 보존)

**PR #96은 머지됐다(`32ff7ec`). 그 직후 실가동이 위 절의 발견(주기 전제 반증·데드맨 4회)을 낳았고,
그 수리가 PR #97이다.** 위 "舊 다음 1건"이 예정했던 "첫 스케줄 런 확인 → S4"는 첫 스케줄 런들이
예상과 다른 사실(간격 2~5시간)을 드러내며 그대로 S4로 가지 않고 **PR #97(주기 전제 수정 +
Healthchecks 재설정)이 먼저 끼어들었다** — 다음 1건은 이 갱신판이 우선한다:

1. **PR #97 머지 승인**(사용자, CLAUDE.md §0-3 ⑩ — 예외 없음). `gh pr view 97 --json
   state,mergeable` → 이 문서 기준일 시점 `OPEN`/`MERGEABLE`, 체크 3종(node lint·typecheck·test /
   의도 vs 실물 대조 / ai-worker ruff·pytest) 전부 `SUCCESS`(재확인할 것).
2. **다음 ping으로 Healthchecks가 UP으로 전환되는지 확인**(ⓗ 명시적 수동 — SaaS 대시보드·텔레그램,
   리포 명령으로 재현 불가). 새 설정(period 1시간·grace 6시간) 아래서 다음 스케줄 런이 도착하면
   `gachinol-monitor` 체크가 DOWN에서 UP으로 전환되는지, 그리고 이후 상시 오탐(공백마다 DOWN)이
   재발하지 않는지가 이 확인의 핵심이다.
3. **뮤테이션 A·D 실행(대장 #203 확인 방법 ⓐ 충족)** — 계획 §4-2 S4(리포 밖
   `~/Claude/plans/transient-cuddling-scroll.md`, 조율자 소유·scribe 미접근이라 뮤테이션 A·D의
   정확한 절차는 그 문서가 원천). 목적은 ⓐ("집 밖 관측점이 실패 1건을 운영자 휴대폰에 도달시킨
   기록")를 실물로 충족하는 것 — 지금까지 인터넷 경로가 계속 200이라 자연 발생한 실패가 없었으므로
   의도적으로 깨뜨려야 한다.
4. **확인되면 S4(2주 report-only 관찰) 착수** — 계획 §4-2. 그 전엔 착수하지 않는다.

가변 값(정확한 승인 시각·다음 ping 결과·뮤테이션 결과)은 여기 적지 않는다 — 위 확인 명령/절차로
그 자리에서 잰다.

### 舊 지금의 다음 1건 (2026-09-11 scribe 갱신 — PR #98 머지 완료 + PR #99 등장으로 아래 절에 대체됨, 규율 13 이력 보존)

**대장 #203 해소 + QUEUE 1단계 완주를 반영한 이 슬라이스(브랜치 `docs/monitor-203-closeout`)가 아직
PR로 열리지 않았다**(`gh pr list --head docs/monitor-203-closeout --json number --jq 'length'` →
**0**, scribe 재확인 2026-09-10T22:26:48Z). 다음 1건은 셋으로 나뉜다:

1. **이 슬라이스 PR 머지 승인**(사용자, CLAUDE.md §0-3 ⑩ — 예외 없음). 문서만 바뀐 슬라이스라
   로컬 3게이트·CI 영향은 없을 것으로 예상되나, PR을 열고 CI 결과를 그 자리에서 확인한 뒤 머지할
   것.
2. **2주 report-only 관측 착수** — 계획 §4-2 S4. 머지 시점을 기산일로 아래 항목을 추적한다(가변
   값은 여기 적지 않는다 — 재현 명령으로 그 자리에서 잰다):
   - **schedule 간격 분포(최대·평균)** — `gh run list --branch main --workflow monitor.yml --limit
     100 --json event,createdAt,conclusion --jq '.[] | select(.event=="schedule" or
     .event=="workflow_dispatch") | [.createdAt,.event,.conclusion] | @tsv' | sort`로 타임스탬프를
     뽑아 연속 간격을 계산한다. 지금까지 실측(2026-09-09~10, 7개 간격): 최소 1.34h·최대 5.21h·
     평균 3.31h. **6h를 넘는 간격이 한 번이라도 나오면 임계(현재 period 1h·grace 6h) 재조정이
     필요하다.**
   - **DOWN 발화 건수와 사유별 분류(진짜 공백 vs 오탐)** — Healthchecks.io 대시보드 값(SaaS,
     scribe 재현 불가). "진짜 공백" = 위 간격 분포가 7h(1h+6h)를 실제로 넘긴 경우, "오탐" = 넘기지
     않았는데도 DOWN이 발화한 경우(설정 오류·판정 로직 결함 신호) — 이 구분 없이 건수만 세면
     상시 오탐이 알림을 무력화했던 #202류 경로를 다시 못 잡는다.
   - **`monitor-freshness` 판정 분포** — 판정 코드 전종(scribe 재확인: `grep -n "code: '"
     infra/scripts/monitor-freshness.mjs` → PASS: `fresh`·`deploying` / FAIL: `bad-sha`·
     `api-stale`·`web-stale`·`approval-stale`·`approval-behind`·`deploy-failed`·`deploy-skipped`·
     `jobs-unreachable`·`api-unreachable` / WARN: `jobs-partial-unreachable`). 2주간 어떤 코드가
     실제로 관측되는지 기록할 것 — `approval-stale`·`approval-behind`류가 잦으면 배포 승인 지연
     (대장 #202류)이 감시에 그대로 잡힌다는 뜻이다.
3. **관측 종료 후 2단계 착수** — QUEUE.md "1단계 완주" 참조, 다음 후보는 2단계 2-1(대장
   #173·#188). 관측 중 임계 재조정이 필요해지면 그것부터 처리한 뒤 착수한다.
   ⚠️ **문구 정정(2026-09-11, scribe — 조율자 판단, 규율 13 원문 보존)**: "관측 종료 후"는
   부정확했다 — 상세는 아래 "⭐⭐ 지금의 다음 1건" 절의 정정 문단 참조. 관측은 개발 착수를 막지 않는다.

가변 값(정확한 관측 결과·재조정 여부)은 여기 적지 않는다 — 위 재현 명령으로 그 자리에서 잰다.

### 舊 지금의 다음 1건 (2026-09-11 scribe 갱신 — 머지 충돌 해소 후, PR #99 머지 완료로 아래 "⭐⭐" 절에 대체됨, 규율 13 이력 보존) — PR #99 머지 → 2주 report-only 관측(이미 기산 중) → 2단계 2-2 착수

**위 절이 기다리던 머지가 일어났다 — `docs/monitor-203-closeout`(PR #98)이 2026-09-11T07:52:33Z
(UTC) `7088dbe`로 main에 머지됐다**(`gh pr view 98 --json mergedAt,mergeCommit` 재확인). 그 직후,
같은 날 이 브랜치(`fix/reporter-capture-stt-canon`, PR #99 — 2-1 유령 영상 수리 + 3-3 STT 정본 정합,
대장 #207 채번 + 게이트②가 잡은 #208·#209)와 문서 2개(이 파일·오늘 일간보고서)가 충돌했다. **이
세션(scribe)이 충돌을 해소**했다 — `docs/**` 문서 편집만, git add·커밋·푸시는 하지 않았다(scribe
git 쓰기 금지). 다음 1건은 셋으로 나뉜다:

1. **PR #99 머지 승인**(조율자·사용자, CLAUDE.md §0-3 ⑩ — 예외 없음). 충돌 해소 결과를
   `git add`·커밋·푸시한 뒤 CI 재통과(`gh pr checks 99`)를 확인하고 머지할 것. 병합 전 마지막
   CI는 체크 3종 SUCCESS(node lint·typecheck·test / ai-worker ruff·pytest / build web)였다(오늘
   일간보고서 ①·④ 참고) — 병합 커밋 위에서 다시 재확인해야 한다.
2. **2주 report-only 관측은 이미 기산 중이다** — 계획 §4-2 S4, 기산일 = PR #98 머지 시각
   (2026-09-11T07:52:33Z UTC). 별도로 "시작"하는 액션은 없다 — 그 시각 이후 스케줄 런이 자연히
   쌓인다. 추적 항목(가변 값은 여기 적지 않는다 — 재현 명령으로 그 자리에서 잰다)은 위 舊 절과
   동일하다: **schedule 간격 분포**(`gh run list --branch main --workflow monitor.yml --limit 100
   --json event,createdAt,conclusion --jq '.[] | select(.event=="schedule" or
   .event=="workflow_dispatch") | [.createdAt,.event,.conclusion] | @tsv' | sort`, 6h 넘는 간격이
   한 번이라도 나오면 임계 재조정) · **DOWN 발화 건수와 사유별 분류**(Healthchecks.io 대시보드,
   scribe 재현 불가) · **`monitor-freshness` 판정 분포**(판정 코드 전종은 위 舊 절 참조). 종료
   시점(+14일)에 재조정 여부를 판단한다.
3. **관측 종료 후 2단계 착수 — 다음 후보는 2-1이 아니라 2-2다.** QUEUE.md 2단계 표(`docs/plan/exec/QUEUE.md`
   259~262행)의 2-1(대장 #173·#188, 유령 영상+린트)은 **이미 PR #99에 구현돼 머지를 기다리는 중**이다
   — 舊 2-1·2-2(대장 #168·#181)가 PR #96 머지 후 별도 scribe 세션에서 행 제거된 것과 같은 패턴으로,
   **QUEUE.md의 2-1 행 자체는 PR #99가 머지된 뒤 별도 세션이 제거해야 한다**(이 세션은 QUEUE.md를
   건드리지 않았다 — 순서 변경은 scribe 단독 권한 밖). 2-2(대장 #178, `.web.*` 로드 경로 확보)는
   QUEUE.md상 선행 조건이 "2-1"이므로, **PR #99가 머지되는 순간 2-2의 선행 조건이 충족돼 착수
   가능해진다**(단 2-1의 린트로는 #178을 원리적으로 못 닫는다고 #188 본문이 명시했으므로 별도
   행으로 남아 있다). 관측 중 임계 재조정이 필요해지면 그것부터 처리한 뒤 착수한다.
   ⚠️ **문구 정정(2026-09-11, scribe — 조율자 판단, 규율 13 원문 보존)**: "관측 종료 후 2단계
   착수"는 부정확했다. QUEUE.md `:229-231`이 이미 "완주 ≠ 관찰 종료 … 이 완주와 별개로 계속된다"고
   명시했고, 바로 위 문장 자신도 "관측 중 임계 재조정이 필요해지면 그것부터 처리한 뒤 착수한다"고
   적어 **관측 중 착수를 전제**한다 — 절 안에서 이미 모순이었다. report-only는 "감시가 배포를
   막지 않는다"는 뜻이지 개발 정지가 아니다. 조율자 판단: **지금 착수가 맞다** — 2주 관측 종료
   (기산일 2026-09-11T07:52:33Z + 14일 = 2026-09-25)를 기다리지 않는다. 최신 판단은 아래
   "⭐⭐ 지금의 다음 1건" 절 참조.

가변 값(정확한 승인 시각·관측 결과·재조정 여부)은 여기 적지 않는다 — 위 재현 명령으로 그 자리에서
잰다.

### 舊 지금의 다음 1건 (2026-09-11, scribe 갱신 — PR #99 머지 완료 + QUEUE 2단계 재정렬 반영, 2026-09-12 PR #100 머지 + 실기 검증 5건 발견으로 아래 "⭐⭐⭐" 절에 대체됨, 규율 13 이력 보존)

**PR #99가 머지됐다**(main 머지커밋 `9d0ed53`, 브랜치 `fix/reporter-capture-stt-canon` —
`git log --oneline -1 origin/main` 재확인). 이 세션이 그 결과를 정본 3곳(PIVOT-PLAN 대장·QUEUE·
본 문서)에 반영했다. 다음 1건은 셋으로 나뉜다 — **순서상 나란히 진행되지, 하나가 다른 하나를
막지 않는다**(아래 "정정" 문단 참고):

1. **QUEUE 2단계 새 2-1(대장 #178, `.web.*` 로드 경로 확보) 착수 가능** — QUEUE.md의 舊 2-1(대장
   #173·#188)은 이 세션이 PR #99 머지를 반영해 행을 제거했다(QUEUE.md "2단계" 절 참조). 선행이던
   "2-1"이 충족·제거됐으므로 새 2-1(舊 2-2, #178)의 선행은 "없음"이다 — 착수 차단자가 없다.
   ⚠️ **#178의 해소 판정문은 이 세션이 좁혔다**(규율 18 사례 — 舊 판정문은 명시 경로 import 한 줄로도
   문자 그대로 충족돼 모듈 *해석* 결함을 못 잡았다): 새 판정문은 **".web 접미사를 쓰지 않은 import
   경로가 `.web.*` 파일로 해석되는 것을 실행 로그로 증명"**(PIVOT-PLAN 대장 #178 참조). ⚠️ **진단도
   한 겹 더 들어갔다** — 증상은 "멀티 프로젝트 미설정"이지만 단일 원인은 `react-native`의
   `jest-preset.js`(`haste.platforms`에 `'web'` 부재)이고, 수리 재료(`jest-expo/web/jest-preset.js`)는
   이미 리포 의존성 안에 있어 **신규 의존 0**이다(scribe 재확인, PIVOT-PLAN 대장 #178 참조).
2. **대장 #173 잔여 — 웹 실기 촬영 1건 완주(수동)** — PR #99는 코드 수리(`launchCameraAsync` 전환)와
   게이트②(jest 뮤테이션) 검증까지만 완료했다. PR #99 본문 자신이 *"네이티브 실기기 미검증 — jest
   DI fake로만 확인했습니다"*라고 자인했고, scribe가 WORKLOG·HANDOFF·전 일간보고서를 재검색해도
   이 새 경로의 실기 촬영 완주 기록은 없다(2026-08-29~30 기록은 이 수리 이전 — 당시는 갤러리 선택
   경로만 됐다). **QUEUE에는 별도 행이 없다**(舊 QUEUE 2-1이 #173·#188을 묶어 다뤘고 그 행이 이미
   제거됐으므로) — 이 잔여를 QUEUE에 다시 편입할지, 실기 검증만 별도 트랙(사람 작업, 기기 필요)으로
   둘지는 조율자 판단 대상이다(PIVOT-PLAN 대장 #173 참조).
3. **신규 채번 대장 #210**(#188 동반 의무 D1 잔여 — subscriber·control-center의 `app/**`가 여전히
   어느 검사에도 안 걸린다, 22파일 5,125행) — QUEUE 편입 여부 미정(scribe는 등재만, PIVOT-PLAN
   대장 #210 참조).

⚠️ **정정(2026-09-11, 조율자 판단 — 위 "舊" 절의 "관측 종료 후 착수"는 부정확했다, 규율 13)**: 2주
report-only 관측(기산일 2026-09-11T07:52:33Z UTC, +14일 = 2026-09-25)은 **개발 착수를 막지 않는다**
— QUEUE.md `:229-231`이 이미 "완주 ≠ 관찰 종료 … 이 완주와 별개로 계속된다"고 명시했고,
report-only는 "감시가 배포를 막지 않는다"는 뜻이지 개발 정지가 아니다. **위 1·2·3은 관측과
병행하고, 관측 중 임계 재조정이 필요해지면 그것부터 먼저 처리한다**(이 조건만 우선순위를 갖는다
— 관측 종료 자체를 기다리지 않는다).

가변 값(정확한 착수 시각·관측 결과·재조정 여부)은 여기 적지 않는다 — 위 舊 절의 재현 명령으로
그 자리에서 잰다.

### 舊 지금의 다음 1건 (2026-09-12, scribe 갱신 — PR #100 머지(대장 #178 해소) + 실기 검증이 드러낸 5건. 2026-09-13 "업로드 경로 복구" 슬라이스(PR #102·#103, 대장 #213·#212·#211 수리)의 완료·미완 갈림으로 아래 "⭐⭐⭐⭐" 절에 대체됨, 규율 13 이력 보존)

⚠️⚠️ **최우선 — scribe가 이 갱신 중 우연히 발견한 라이브 이상 징후(위임 범위 밖, 조율자 즉시 확인
요청)**: **제온 프로덕션 api 컨테이너가 지금 origin/main(`2035cf2`)이 아니라 2026-09-02 시점
이미지를 서빙 중이다.** `Build Images` 워크플로(run `34697629544`, `2035cf2` 대상)는 **success**이고
그 로그 안의 `docker compose ps` 조차 배포 직후(`2026-09-12T13:57:56Z`) `gachinol-prod-api-1
ghcr.io/***/gachinol-api:sha-2035cf2 ... Up Less than a second`을 정상 보여준다 — **CI는 정확히
할 일을 했다.** 그런데 scribe가 그 몇 분 뒤(`14:04~14:09 UTC`) 독립적으로 재확인하니 상태가 바뀌어
있었다: `ssh xeon "docker inspect gachinol-prod-api-1 --format '{{.Created}} {{.Config.Image}}'"` →
컨테이너가 `2026-09-12T14:04:01Z`에 **`ghcr.io/homedcp/gachinol-api:latest`**로 다시 생성돼 있고
(CI가 만든 `sha-2035cf2` 컨테이너가 아니다), 그 `:latest` 태그의 실제 digest(`sha256:7f3b036a...`)가
가리키는 `GIT_SHA`는 **`3f8e87316d991576c13e91570e90ffa9077eaa95`**(2026-09-02 시점 커밋)다.
scribe 재확인(반복 재현, 2026-09-12T14:09Z): `curl -s https://api.bapfull.com/v1/health/version` →
`{"sha":"3f8e87316d991576c13e91570e90ffa9077eaa95"}`(cf-cache-status: DYNAMIC — CDN 캐시 아님, 매
요청 오리진에서 응답) · `curl -s https://api.bapfull.com/health/version` → **404**(`Cannot GET
/health/version"` — 이 무프리픽스 라우트는 현재 main 코드의 `setup-app.ts:29-30`가 명시적으로 붙인
것이라 2026-09-02 이미지엔 없다, 즉 신구 불일치의 별개 증거). **이 재생성을 일으킨 GitHub Actions
워크플로 런은 없다**(`gh run list --limit 15`로 그 시각 전후 대조, `docker ps -a`에 watchtower류
컨테이너도 crontab도 없음) — **제온에서 수동으로(또는 이 세션과 병행 중인 다른 작업으로) `docker
compose up -d api`류 명령이 `IMAGE_TAG`를 지정하지 않은 채 실행돼 compose 기본값(`${IMAGE_TAG:-latest}`)
으로 떨어진 것으로 보인다** — 단정하지 않는다, 조율자가 직접 확인할 것. web 컨테이너는 정상
(`ghcr.io/homedcp/gachinol-web:2035cf2d...`, 영향 없음). **이 문서의 "PR #100 배포 완주" 서술은
CI 시점 기준으로는 사실이었으나, 지금 이 순간 실물 상태와는 다르다** — 다음 세션은 반드시
`curl -s https://api.bapfull.com/v1/health/version`을 먼저 재실행해 SHA를 확인할 것. (scribe는 이
발견에 대해 아무것도 고치지 않았다 — 권한 밖·위임 범위 밖.)

**PR #100이 머지됐다**(main 머지커밋 `2035cf2d0618d06e1b9a9756f7d40c1f80d231cd`, 브랜치
`chore/web-jest-resolution` — `git log --oneline -1 origin/main` 재확인). 이 세션이 그 결과를 정본
3곳(PIVOT-PLAN 대장·QUEUE·본 문서)에 반영했다. 위 "舊" 절의 다음 1건 3갈래 중 1번은 이걸로 완료됐고,
같은 날 실기 검증이 5건을 새로 드러냈다. 다음 1건은 이제 다음으로 나뉜다:

1. ~~QUEUE 2단계 새 2-1(대장 #178) 착수~~ → **완료(2026-09-12, PR #100)**. scribe가 해소 판정문
   ("접미사 없는 import가 `.web.*`로 해석되는 것을 실행 로그로 증명")을 그 자리에서 직접 재실행:
   `pnpm --filter @gachinol/reporter test:web` → 1스위트 3/3 pass · `pnpm --filter @gachinol/subscriber
   test:web` → 3스위트 10/10 pass, 양쪽 다 로그에 접미사 없는 import→`.web.*` 해석이 실제로 찍힌다.
   QUEUE 2단계는 이제 **2-1(대장 #177)만 남았다**(舊 2-2가 당겨짐).
2. **대장 #173 잔여 — 웹 실기 촬영 1건 완주(수동)는 여전히 미완**(변경 없음, 위 舊 절 그대로 carry).
3. **대장 #210(subscriber·control-center `app/**` 미검사, 22파일 5,125행)도 QUEUE 편입 미정**(변경
   없음, carry).
4. **신규 — 2026-09-12 실기 검증(기자 웹 촬영→업로드, 사용자 최초 실기 시도)이 5건을 드러냈다**
   (PIVOT-PLAN 대장 #169 갱신 + 신규 채번 #211~#214, 전부 "미수신"으로 등재만 — scribe는 판정하지
   않는다):
   - **#169**(재등재 아님, 진행 상태 갱신) — 2026-08-30 등재 당시 "터널에서의 업로드 PUT·서명 재생이
     구조적으로 불가"라던 예고가 실기로 실증됐다. 부분 수리 진행 중: Cloudflare 터널에
     `media.bapfull.com`→`minio:9000` 라우트 추가 **완료**(사용자, 2026-09-12) — scribe 재현
     `curl -s -o /dev/null -w "%{http_code}" https://media.bapfull.com/` → 403(AccessDenied, 서명
     없는 요청 정상 거부 — 라우트는 살아 있다는 증거). **남은 것은 제온 설정값
     `S3_PUBLIC_ENDPOINT`를 그 호스트로 바꾸는 것**(QUEUE §C-6 신설, 사용자 실행 대기). 이걸 끝내도
     #211(아래) 때문에 업로드 전체가 풀리지는 않는다.
   - **#211**(신규) — 원본 촬영본이 Cloudflare 요청 바디 100MB 한도를 상시 초과(제온 DB 실측: 10건
     중 6건 60% 초과, 최대 173MB, 평균 128MB — scribe가 그 자리에서 SELECT 재실행해 확인).
   - **#212**(신규) — 업로드 2차 재시도가 콘텐츠를 영구 `uploading` 교착시킨다(코드+DB 양쪽 scribe
     재확인 — 대장 #168 수리분과는 다른 분기). **사용자의 실제 콘텐츠 1건이 지금도 갇혀 있다.**
   - **#213**(신규) — `all-exceptions.filter.ts`가 4xx 전부(400·401·403·404·409)를 로그 없이 반환한다
     (scribe 코드 재확인 — `logger.error`는 파일 전체에 500 분기 1곳뿐). 이번 장애를 nginx
     접근로그 없이는 특정 불가능하게 만든 원인.
   - **#214**(신규, 해소 아님) — 감시가 "페이지 200"만 보고 "미디어가 실재하는가"를 안 묻는다.
     **implementer가 같은 슬라이스에서 이미 수리 진행 중**(D1 — `deploy-smoke.mjs`·
     `monitor-freshness.mjs`에 미디어 도달성 검사 배선). 작업 완료 후 조율자 확인 뒤 scribe가
     별도 갱신한다 — 지금 해소로 적지 않았다.
   - ⚠️ **QUEUE 2단계/3단계 어디에 이 5건을 배치할지는 scribe 권한 밖이다** — scribe는 대장에
     등재만 했고 QUEUE.md 표는 건드리지 않았다. **조율자가 순서를 판정할 것.**

가변 값(정확한 착수 시각·SHA·관측 결과)은 여기 적지 않는다 — 위 각 항목의 재현 명령으로 그 자리에서
잰다. 2주 report-only 관측(기산일 2026-09-11T07:52:33Z, 종료 2026-09-25)은 계속 진행 중이며 위 1~4와
병행한다(관측 종료를 기다리지 않는다 — 舊 절의 정정 문단 그대로 유효).

### 舊 지금의 다음 1건 (2026-09-13, scribe 갱신 — "업로드 경로 복구" 슬라이스 종료: PR #102·#103 머지 대기. 2026-09-14 PR #102 머지·배포 + PR #103 오머지 사고(→PR #104로 재제출·머지)로 아래 "⭐⭐⭐⭐⭐" 절에 대체됨, 규율 13 이력 보존)

**조율자가 QUEUE 사다리로 판정**(#213=L-obs 계측기 → #211=L1 도달 경로 → #212=L2 실발생 순, 배경은
QUEUE §2단계 2-1 참조)해 세 건을 한 슬라이스로 묶었고, 구현은 완료됐다. **산출물은 PR 2개, 둘 다
머지 대기(사람 몫)**:

- **PR #102**(`fix/upload-path-recovery`, base `main`) — `a4a2d8a`(대장 #213, 4xx 관측성 로그) ·
  `812a173`(대장 #212, 업로드 재시도 영구교착 수리). CI 전건 SUCCESS(scribe 재확인:
  `gh pr view 102 --json statusCheckRollup`).
- **PR #103**(`feat/multipart-upload`, base가 **#102인 스택 PR**) — `41f93c6`(대장 #211 서버측, 멀티파트
  업로드 3라우트) · `9a086f3`(대장 #211 클라이언트측, 기자 웹 파트 분할 업로드). CI 전건 SUCCESS(scribe
  재확인, 2026-09-13: `gh pr view 103 --json statusCheckRollup` → build api·web·media-worker·ai-worker·
  node(lint·typecheck·test) 전부 SUCCESS, `mergeable: MERGEABLE`).

**PIVOT-PLAN 대장 3행(#211·#212·#213) 상태 칸을 "수리 완료·PR 대기"로 갱신했다** — "명령이 초록"과
"결함이 해소됐다"는 다르다(CLAUDE.md 규율): 셋 다 각 행의 해소 판정 기준(수동 실기)이 **배포 이후에만
실증 가능**하므로 해소로 적지 않았다. 상세·재현 명령은 PIVOT-PLAN 대장 #211·#212·#213 참조.

**대장 #211에 조율자 실측이 새로 실렸다** — Cloudflare 요청 바디 한도가 **Tunnel 경로에도 적용됨을
실측으로 확정**했다(공식 문서가 침묵하던 공백): 서명 없는 PUT(MinIO 403 거부, 데이터 무영향)으로 이분
측정 → 100MiB(104,857,600B)까지 통과·101MB부터 413. 상세는 대장 #211 참조.

**대장 #169는 재생·썸네일 축만 부분 해소됐다** — QUEUE §C-6②(제온 `S3_PUBLIC_ENDPOINT` 전환)가
충족됐고, `node infra/scripts/media-reachability.mjs --api-url https://api.bapfull.com` → **PASS**(scribe
독립 재현). 업로드 축은 #211이 남아 있어 행 전체는 미해소. **대장 #214도 이번에 해소로 갱신했다** —
media-reachability.mjs가 그 자리에서 실제로 PASS를 낸 것이 조율자가 확인한 "실물 판정" 증거다.

**신규 채번 6건(#216~#221, 전부 등재만 — QUEUE 편입은 조율자 판단)**: #216(admin 술어 비대칭 —
`loadOwned`는 admin 통과·`content-workflow.service.ts:526` `requireOwnerReporter`는 admin 차단, 기자가
만든 콘텐츠에 admin이 upload-complete를 호출하면 자산 ready·콘텐츠 uploading 불일치가 남는다) ·
#217(api 유닛 저빈도 플레이크, 2회 관측·재현 안 됨) · #218(monitor.yml 실패 로그에 실패 라우트 상세가
없다 — #213과 같은 부류의 공백이 감시 쪽에도 있음) · #219(MinIO `AbortIncompleteMultipartUpload`
라이프사이클 미설정, 고아 0건·1.8T 여유라 급하지 않음 — QUEUE §C-7 신규) · #220(BigInt `toEqual`
리포팅 크래시, 저등급) · #221(멀티파트 전용 재시도 시퀀스 테스트 부재, 저등급). 상세는 PIVOT-PLAN
대장 해당 행 참조.

**사용자 실행 3건(요청 시점 순서대로)**:
1. **PR #102·#103 머지** — 순서대로(스택 PR이라 #102 먼저). 머지되면 자동 배포(main 머지 = 프로덕션
   배포, `production` Environment 승인 게이트 통과 필요, QUEUE §D-1 참조).
2. **갇힌 콘텐츠 수동 복구** — 콘텐츠 `01a09166-aac7-774e-b95b-5efc617d8a06`를 `uploading`→
   `upload_failed`로. ⚠️ **반드시 #212 배포 이후에** 할 것(먼저 풀면 수리 전 코드가 또 교착시킨다).
   조율자 확인 몫(scribe는 프로덕션 DB 접근 권한이 없다 — 아래 함정 참조).
3. **MinIO 라이프사이클 규칙**(QUEUE §C-7, 대장 #219) — `mc ilm` 자격증명 필요. 요청 시점은 **#103이
   머지되어 멀티파트가 실제 트래픽을 받기 직전**(지금 당장은 고아 0건·1.8T 여유라 급하지 않다).

**다음 세션의 실질 다음 1건은 #211 해소 판정에 필요한 실기 검증**이다 — 한도(100MiB)를 넘는 실촬영
분량 업로드 1건을 배포 이후 완주해야 대장 #211이 해소로 바뀐다(#212·#213도 각자의 수동 실증이 필요,
위 사용자 실행 ①②가 선행).

⚠️ **조율자가 프로덕션 DB에 SELECT조차 못 한다** — `ssh xeon ... psql ...`류 명령이 auto mode 분류기에
차단된다(이번 세션에서 실제로 겪음). DB 실측(예: 위 ②의 콘텐츠 상태 확인, 대장 #212가 인용한 상태
전이 로그 재확인 등)이 필요하면 **사용자 실행이거나 권한 조정이 선행**돼야 한다.

가변 값(정확한 착수 시각·SHA·테스트 계수)은 여기 적지 않는다 — 재현 명령:
```bash
pnpm --filter @gachinol/shared build   # 선행 — stale dist면 api 유닛이 거짓 실패
pnpm --filter @gachinol/api test
pnpm --filter @gachinol/reporter test
pnpm --filter @gachinol/reporter test:web
node infra/scripts/daejang-recheck.mjs
gh pr view 102 --json statusCheckRollup,mergeable
gh pr view 103 --json statusCheckRollup,mergeable
```
2주 report-only 관측(기산일 2026-09-11T07:52:33Z, 종료 2026-09-25)은 계속 진행 중이며 위와 병행한다.

### ⭐⭐⭐⭐⭐ 지금의 다음 1건 (2026-09-15, scribe 갱신 — PR #102·#104 머지·배포 완료 + PR #103 오머지 사고 수습)

**PR #102가 main에 머지·배포됐다** — 대장 #213(4xx 무로깅)은 조율자가 프로덕션에서 4xx 2건을 실제로
유발해 컨테이너 로그에 그 사실이 남는 것을 실증해 **해소**로 확정했다. 대장 #212(업로드 재시도 영구
교착)는 배포는 됐으나 해소 판정(HEAD 부재 실패 후 같은 콘텐츠로 2차 재시도 완주)이 아직 실기로
확인되지 않아 **배포 완료·실기 검증 대기**다.

⚠️ **PR #103이 `main`이 아니라 base였던 `fix/upload-path-recovery`로 머지되는 사고가 났다** — 스택
PR의 base는 **base 브랜치가 삭제될 때만** 자동으로 `main`으로 바뀌는데, 조율자가 그 조건을 확인하지
않고 "#102를 먼저 머지하면 base가 자동으로 main이 된다"고 안내한 것이 원인이다. 그 결과 멀티파트
업로드 코드가 브랜치에만 남고 배포되지 않은 채 있었다(그 시점 실측: `POST .../multipart-upload` →
404). **교훈: 스택 PR을 순서대로 머지할 때는 매번 `gh pr view <n> --json baseRefName`으로 실제
base를 확인하고, "자동으로 main이 된다"를 전제하지 않는다.** 조율자가 **PR #104**(PR #103과 동일
커밋, base를 main으로 재지정해 재제출)로 다시 열어 main에 머지·배포했다. 배포 후 라우트 존재는
확인됐으나(404 → 401로 전환) 대장 #211의 해소 판정(한도 초과 실촬영 업로드 1건 완주)은 여전히
**미충족**이라 상태는 '배포 완료·실기 검증 대기'다. 이 머지 사고 자체는 새 감시 공백(대장 #222 —
"감시가 머지한 PR이 실제로 main에 들어갔는가를 묻지 않는다")으로 별도 등재했다.

**진행 중(다른 에이전트, 동시 작업) — 대장 #216.** `loadOwned`(admin 통과)와
`content-workflow.service.ts`의 `requireOwnerReporter`(admin 차단)가 소유권 판정을 다르게 취급하던
비대칭을, 사용자 결정에 따라 **`requireOwnerOrCenter`로 통일하는 방향**으로 수리 중이다
(`services/api/src/contents/content-workflow.service.ts`와 그 테스트가 대상 — scribe는 이 파일들을
건드리지 않았다). 완료되면 대장 #212가 남긴 "프로덕션에 갇힌 콘텐츠 1건
(`01a09166-aac7-774e-b95b-5efc617d8a06`)"을 admin이 `failUpload` API로 직접 복구할 수 있게 될
가능성이 있다(확정 아님 — #216 머지 후 재확인 대상).

**舊 사용자 실행 3건(요청 시점순, 2026-09-15 갱신 — 규율 13 원문 보존)**:
1. ~~**MinIO 라이프사이클 규칙**(QUEUE §C-7, 대장 #219) — 요청 시점이 "**PR #103(#104) 머지 직전**"
   이었는데 **PR #104로 머지가 완료돼 지금이 그 시점이다.** `mc ilm` 자격증명 필요. 확인 명령:
   `mc ilm ls gachinol-media`에 `AbortIncompleteMultipartUpload` 규칙이 있는지.~~ — ❌ **철회
   (2026-09-15, scribe 2차) — 요청 불요.** 대장 #219가 조율자 재조사로 해소(결함 아님) 판정됐다
   (MinIO 서버 기본 정리 동작 `stale_uploads_expiry`/`cleanup_interval` 존재 — 아래
   "⭐⭐⭐⭐⭐⭐ 갱신" 절 참조). QUEUE §C-7도 함께 철회.
2. **갇힌 콘텐츠(`01a09166-aac7-774e-b95b-5efc617d8a06`) 수동 복구** — **#216 머지 후 재판단**할 것
   (DB 직접 UPDATE가 필요할지, #216이 배선하는 API 경로로 될지가 그때 갈린다. 먼저 손대면 #216 이전
   코드로 다시 교착시킬 수 있다). ⚠️ **#216은 2026-09-15 수리 완료됐으나 아직 PR·머지·배포 전**이다
   (브랜치 `fix/upload-actor-predicate` 커밋 `3627fa8`) — 이 항목의 선행이 "머지"에서 "PR 오픈부터"로
   한 단계 앞당겨졌다.
3. **#211·#212 실기 검증** — #211은 한도(100MiB)를 넘는 실촬영 분량 업로드 1건 완주, #212는 HEAD
   부재 실패 후 같은 콘텐츠로 2차 재시도 완주. 둘 다 배포는 끝났고 실기만 남았다.

⚠️ **조율자의 프로덕션 DB 접근 차단은 계속 유지된다** — `ssh xeon ... psql ...`류 명령이 auto mode
분류기에 차단되는 현상이 이번에도 동일했다(2026-09-13 세션에서 처음 겪었고 아직 해결되지 않음). DB
직접 조회·복구가 필요한 작업은 이 제약을 먼저 감안해 계획할 것.

**신규 채번 2건(#222·#223, 등재만 — QUEUE 편입은 조율자 판단)**: #222(감시가 "머지한 PR이 실제로
main에 들어갔는가"를 묻지 않는다 — PR #103 사고가 그 공백에서 발생, `monitor.yml`은 SHA 일치만 보고
PASS를 냈다) · #223(Cloudflare 간헐 `error code: 1018` 관측, 저등급 — 대장 #218의 원인 후보일 수
있으나 단정하지 않음). 상세는 PIVOT-PLAN 대장 해당 행.

가변 값(정확한 머지 시각·SHA·테스트 계수)은 여기 적지 않는다 — 재현 명령:
```bash
git rev-parse origin/main
curl -s https://api.bapfull.com/health/version
gh pr view 102 --json state,mergedAt,mergeCommit
gh pr view 103 --json state,baseRefName
gh pr view 104 --json state,mergedAt,mergeCommit
node infra/scripts/media-reachability.mjs --api-url https://api.bapfull.com
node infra/scripts/daejang-recheck.mjs
```
2주 report-only 관측(기산일 2026-09-11T07:52:33Z, 종료 2026-09-25)은 계속 진행 중이며 위와 병행한다.

### ⭐⭐⭐⭐⭐⭐ 갱신 (2026-09-15, scribe 2차 — 대장 #216 수리 완료 반영 + 대장 #219 정정(결함 아님) + QUEUE §C-7 철회 + 대장 #217 추가 관측 / scribe 3차 — 사용자 결정으로 CLAUDE.md §4 정본 개정 + 대장 #224 채번 / scribe 4차(2026-09-16) — 대장 #224 수리 완료 반영 + 사용자 결정(소유 기자도 복구 허용)으로 CLAUDE.md §4 재개정 + 신규 채번 5건(#225~#229) + 대장 #217 추가 관측)

**대장 #216(admin 술어 비대칭) — 수리 완료, PR 대기(머지·배포 전, "해소"가 아니다).** 브랜치
`fix/upload-actor-predicate` 커밋 `3627fa8`: `userHop`·`failUploadTx`의 술어를 `requireOwnerReporter`
에서 `requireOwnerOrCenter`로 통일(`cancel()`이 이미 쓰던 기존 술어 재사용, 새 정책 발명 아님) +
컨트롤러 5라우트(upload-url·upload-complete·multipart-upload·multipart-upload-complete·
multipart-upload-abort)를 `@Roles('reporter','center_operator')`로(**사용자 결정 2026-09-15**,
`contents.controller.ts:201` `cancel()`과 동형). `policyGuard`③(기자 승인은 담당 기자만)은 불변 —
게이트②가 그것을 무너뜨리는 뮤테이션 1건을 red로 잡아 방어망 실재를 실증했다. 감사 로그
`actorUserId`에는 실제 행위자가 남는다(system으로 바꾸지 않았다). 멀티파트 완료·중단 경로도 같은
관문이라 함께 풀린다. 동반 의무(D1): `upload.controller.spec.ts` 신설 26건(`@Roles` 메타데이터 전수
단언 + `RolesGuard` 실구동, #181 선례) + 정방향 성공 7건. 게이트①: lint 0·typecheck 0·
**api 79스위트/1031tests(조율자 확정치)**·controller-role-gate PASS(76라우트).

⚠️ **게이트②가 초판의 결함 2건을 잡았다**(이 리포는 실패를 지우지 않는다): ① 초판이 **컨트롤러를
빠뜨려** center_operator가 `RolesGuard`에서 403을 맞고 서비스에 도달조차 못 했다 — 실질 수혜자가
admin 하나뿐이었다. 원인은 조율자 위임문이 `cancel()`을 선례로 들며 "2곳만 바꿔라"고 특정해
컨트롤러를 지목하지 않은 것(그 선례는 서비스·컨트롤러가 함께 맞춰져 있었다). ② 초판 D1이
**정방향("기자 본인 성공")을 보지 않아**, 기자 분기를 제거하는 뮤테이션에 신설 11건이 전부
무반응이었고 기존 파일이 우연히 잡았다(그게 없었다면 "기자 자기 업로드가 깨져도 초록"). 조율자가
보완 후 독립 재현해 신설 스위트 5건이 red임을 확인했다. **다음 세션 할 일**: PR 오픈 → 머지 →
배포 → #216을 '해소'로 갱신 + 갇힌 콘텐츠(`01a09166-aac7-774e-b95b-5efc617d8a06`) 재판단.

**대장 #219 — 정정 완료: 해소(결함 아님).** 조율자가 재조사해 원 등재의 전제("고아 정리는 버킷
라이프사이클 규칙뿐이다")가 틀렸음을 확인했다 — **MinIO는 미완성 멀티파트 업로드를 서버 차원에서
기본 정리한다**(`api stale_uploads_expiry` 기본 **24시간** · `api stale_uploads_cleanup_interval`
기본 **6시간**). `AbortIncompleteMultipartUpload` 라이프사이클 규칙은 정리를 켜는 스위치가 아니라
그 전역 기본값 대신 버킷별 기간을 쓰고 싶을 때의 선택 항목일 뿐이며, 우리 상황(디스크 1.8T 여유·
고아 0건·코드가 완료 실패·취소·파트 실패에서 이미 abort 호출)에서는 **실익이 없다**. **대장 #114와
동형**("명령(또는 서술)이 검출했으나 결함 자체가 없었다"). 사실 정정 블록은 PIVOT-PLAN 대장 #219
(칸2)에 원문 보존과 함께 남겼다. ⚠️ **조율자가 하마터면 틀린 명령까지 안내할 뻔한 것도 재발 방지를
위해 기록**: `mc ilm rule add`에는 애초에 `AbortIncompleteMultipartUpload` 플래그가 **없다**(제온
컨테이너에서 `mc ilm rule add --help`를 직접 읽어 확인 — `--expire-days`·`--transition-days`·
`--noncurrent-*`뿐, 넣으려면 JSON을 `mc ilm rule import`로 주입하는 별도 경로가 필요). ⇒ "명령을
지어내지 말고 그 자리에서 도움말을 읽는다"(대장 #215의 교훈)가 작동한 사례. ⚠️ **미확인**: 제온
MinIO의 실제 config 값이 기본값인지는 자격증명 없이 확인 불가 — 우리가 그 설정을 바꾼 기록이 없어
기본값일 가능성이 높다는 **추정**일 뿐이다. 확인 명령: `docker exec gachinol-prod-minio-1 mc admin
config get <alias> api`(자격증명 필요, 사용자 실행 — 급하지 않음).

**QUEUE §C-7 철회(2026-09-15)** — 위 정정에 따라 "사용자 실행 항목"에서 내렸다. **요청 불요.**

**대장 #217 추가 관측 2건**(이번 슬라이스, implementer 1회·조율자 1회, 커밋 `3627fa8` 게이트①
로그) — 증상 동일(`all-exceptions.filter.spec.ts`가 jest worker SIGSEGV로 스위트 실행 자체 실패,
테스트 실패 0건, 재실행하면 정상). **원인은 여전히 미상이라 해소 아님** — 관측 횟수(총 5~6회)와
"코드 변경과 무관함이 같은 커밋에서의 통과/실패 교대로 뒷받침된다"는 사실만 추가했다.

**정본 파급 조사(D) — center_operator 업로드 권한**: `grep -rn "center_operator"
docs/plan/02-web-architecture.md docs/plan/03-accessibility-ux.md` → **0건**. 업로드를 센터가 할
수 있는지에 대한 명시적 서술이 02·03에 **없다(정본의 침묵)**. 다만 CLAUDE.md §4 역할 표·03 §D
"4대 핵심 플로우"(*"기자 업로드·센터 승인/반려"*)는 업로드를 일관되게 기자 플로우로 명명하고
센터는 승인/반려로 프레이밍한다 — 명시적 모순은 아니지만 이번 권한 확장이 그 프레이밍과 다른
방향이라는 점은 조율자 판단을 위해 남겨 둔다. **scribe는 02·03 본문을 고치지 않았다** — 결과는
PIVOT-PLAN 대장 #216 행에 근거로 기재.

**정본 파급(D) 후속 — 사용자가 정본 개정을 결정했다(2026-09-15, scribe 3차 갱신).** 조율자가 위
침묵을 사용자에게 보고했고, 사용자 원문 *"센터는 기자를 대신해 업로드를 완료 복구 할 수 있도록
해야한다. 관리자의 역할이기 때문이다. admin만 그 역할을 할 수 있도록 하면 실무차원에서 너무
한쪽으로 일이 몰려서 제대로 운영을 할 수 없다. 정본을 수정하도록 한다."*에 따라 **CLAUDE.md §4
"센터 관제 웹" 행을 개정**했다(scribe — 기자의 막힌 업로드를 센터가 완료·실패 처리해 재시도를 열어
주는 **운영 복구 권한**을 명시하고, 촬영·콘텐츠 생성 자체는 여전히 기자 몫이라는 경계를 함께
적었다). **03 §D "4대 핵심 플로우"는 미개정**(조율자 판정, scribe 등재만 — 그 절은 "설치 없이
순수 브라우저로 동작해야 하는 플로우 목록"이지 "누가 할 수 있는가"의 권한 정의가 아니므로 고치면
과잉 개정). ⚠️ **API는 열렸으나 `apps/control-center`에 그것을 호출하는 화면이 0건이다**(scribe
재확인: `grep -rn "upload-complete|multipart-upload" apps/control-center/src apps/control-center/app | wc -l`
→ **0**) — 계약은 있는데 구동 코드가 없는 반복 패턴이라 **대장 #224**로 채번했다(방식 무전제 —
해소 판정은 센터 운영자가 막힌 업로드 콘텐츠 1건을 실제로 완료 또는 실패 처리해 재시도를 여는 것을
완주했는가로만 판단, 특정 UI 형태 전제 없음). **다음 세션 할 일에 추가**: PR #105 머지·배포 후
#216을 재판정할 때 **#224(관제 웹 UI 부재)도 함께 검토**할 것 — 갇힌 콘텐츠
`01a09166-aac7-774e-b95b-5efc617d8a06`(대장 #212)가 #224의 첫 실사용 대상이 될 수 있다(확정 아님).
⚠️ **#216 자체는 이번에도 '해소'로 바꾸지 않았다** — PR #105가 여전히 미머지다.

가변 값(정확한 테스트 계수·시각)은 여기 적지 않는다 — 재현:
```bash
git log --oneline -3
gh pr view 105 --json state,mergedAt
node infra/scripts/daejang-recheck.mjs
node infra/scripts/controller-role-gate.mjs
grep -n "@Roles" services/api/src/upload/upload.controller.ts
grep -rn "center_operator" docs/plan/02-web-architecture.md docs/plan/03-accessibility-ux.md
grep -rn "upload-complete|multipart-upload" apps/control-center/src apps/control-center/app | wc -l
grep -n "센터 관제 웹" CLAUDE.md
```

**scribe 4차 갱신(2026-09-16) — 대장 #224 수리 완료 반영 + CLAUDE.md §4 재개정 + 신규 채번 5건.**

**대장 #224(관제 웹에 업로드 복구 UI가 없다) — 수리 완료, PR 대기(머지·배포 전, "해소"가 아니다).**
브랜치 `feat/upload-stall-recovery` 커밋 `98aaf11`(서버)·`cb99969`(관제 UI). 서버: `POST
/v1/contents/:id/upload-recover` 신설 — 고착 판정은 서버가 `Content.updatedAt`+`UPLOAD_STUCK_MS`
(기본 30분·최소 60초, 컨트롤러 시그니처에 `@Body`·`@Query`·`@Headers` 없어 클라이언트 값이 판정에
물리적으로 닿지 않는다)로만 한다. 임계 30분의 근거를 scribe가 독립 검산: 원본 최대 173MB를 30분에
올리려면 `173*8/1800`Mbps면 충분 — `node -e "console.log((173*8/1800).toFixed(4))"` → **0.7689**
(커밋의 "173MB÷1800s×8≈0.7689Mbps"와 일치). 관제 UI: `centerActionsFor`에 `canRecoverUpload` 전용
액션(uploading에서만, ③ 규칙은 그대로 두고 우회하지 않는 별도 문) · board '업로드 중' 칩 · 409 안내
(`formatUploadRecoverWait`) · 확인 다이얼로그 · 상세에 "마지막 변경: N시간 전". **임계값(30분)을
클라이언트에 복제하지 않는다** — scribe 재확인: `grep -rn "1_800_000\|UPLOAD_STUCK_MS"
apps/control-center/src apps/control-center/app | grep -v __tests__` → 3건, 전부 주석·상수명
언급뿐(대장 #211 상수 복제 재발 방지). ⭐ **결함의 본질이 UI 부재가 아니었다** — `centerActionsFor`
③ 규칙(uploading을 의도적으로 닫아 두는 것)은 옳고, 없던 것은 "정상 진행 중"과 "갇힘"을 구분하는
축이었다(주간추천 `RECOMMENDATION_STUCK_MS` 선례와 동형). 게이트①(scribe 독립 재실행): control-center
**25/301**(기준선 24/282) · api **79/1050**(기준선 79/1031, 이번 재실행에서 #217 미재현) · typecheck·
lint 0 · `controller-role-gate.mjs` PASS(77라우트). 게이트②(verifier, 인용): 1차 게이트 무반응 1건
보완(조율자 독립 재현 5건 red) · 상태 23종 전수 무회귀 · 뮤테이션 4축. **상세는 PIVOT-PLAN 대장 #224
행 참조**(재현 명령·grep 결과 전부 그 행에 있다). ⚠️ **여전히 미해소** — 원 등재의 해소 판정("센터
운영자가 막힌 업로드 1건을 실제로 복구 완주")은 실기로 확인되지 않았다.

**B — 사용자 결정(2026-09-15): 소유 기자 본인도 자기 업로드를 복구할 수 있다.** 조율자가 "갇힌 업로드
복구를 소유 기자도 스스로 할 수 있게 할까?"를 물었고 "기자도 허용"으로 결정됐다(근거: ① 기자는 지금도
`upload-complete` 우회로 같은 효과를 낸다 ② 인접 액션이 전부 소유 기자를 허용해 이 엣지만 좁히면
불일치 ③ 현장 기자가 가장 먼저 발견하는 경우가 많다). **CLAUDE.md:108 "센터 관제 웹" 행에 한 구절
추가**(scribe): 기존 "기자 업로드 완료·복구 대행(...) 사용자 결정 2026-09-15" 뒤에 `— **소유 기자
본인도 자기 업로드를 복구할 수 있다**(사용자 결정 2026-09-15)`를 덧붙였다. 기존 경계 서술("촬영·콘텐츠
생성 자체는 여전히 기자 몫")은 그대로 유지. 서버측 `@Roles('reporter','center_operator')`는 #224
구현에 이미 반영돼 있다(별도 코드 변경 불요, B는 문서·확인 작업).

**C — 신규 채번 5건(#225~#229, 등재만·QUEUE 편입은 조율자 몫).** #224 수리 과정에서 파생됐다:
- **#225** `apps/reporter`에 `upload-recover`를 부르는 코드 0건 — B로 권한은 열렸는데 위임 범위가
  `apps/control-center`로만 특정돼 기자 쪽 수단이 없다(#224와 같은 패턴, 구현자 잘못 아님).
- **#226** `POST /:id/transitions`(범용 전이)가 고착 검사 없이 `uploading→upload_failed`를 강제
  가능 — **pre-existing**, `isAutoProgressContentStatus('uploading')===true`라 관제 UI엔 버튼이 없어
  실질 위험 낮음(#224 게이트② 판정).
- **#227** `completeUpload`·`completeMultipartUpload`·`abortMultipartUpload`도 `recoverStalledUpload`
  와 구조적으로 동일한 "1차 게이트(`loadOwned`) 미단언" 테스트 사각을 안고 있음(2차 게이트가 독립
  지탱해 즉각 취약점은 아님).
- **#228** `apps/control-center/src/api/contents.ts`의 액션 wrapper 전체가 URL을 검증하지 않음
  (`detail-screen.test.tsx`가 모듈 통째 mock — 이번 PR 고유 결함 아니고 기존 액션 전부의 패턴).
- **#229** `ContentSummary`(목록 DTO)에 `updatedAt` 부재 — `Content`(상세)만 `Timestamps` extends,
  board '업로드 중' 칩에서 정상 업로드와 갇힌 것이 구분 없이 섞여 보임(shared 무변경 제약상 불가피).

**D — 대장 #217 추가 관측(2026-09-16, 커밋 `98aaf11` 게이트① 로그: 1050 기대 중 1042 passed →
8건 차이). ⚠️ 조율자 정정(2026-09-16, 규율 13 원문 보존)**: 커밋 `98aaf11` 원문("직전은 5건 차이
(`all-exceptions.filter.spec.ts`)였는데 이번은 8건 차이였다 — 특정 파일 문제가 아니라 jest worker가
**무작위 스위트**에서 죽는다는 뜻이다")은 **조율자의 착오였다** — "5건"이라는 값은 실제 관측 어디에도
없다. **정정된 관측 계수 3회**: ① 2026-09-14 987 기대 중 974 passed → **13건 차이**(스위트 미상)
② 같은 회차 979 passed → **8건 차이** ③ 2026-09-16(본 슬라이스) 1050 기대 중 1042 passed →
**8건 차이**. scribe 실측: `pnpm --filter @gachinol/api test -- all-exceptions.filter` →
**1/1·8/8** — **8건 차이 2회(②·③)는 이 스위트 크기와 일치**하지만 **13건 차이 1회(①)는 설명되지
않는다**. ⇒ **"무작위 스위트"도 "특정 파일"도 아직 단정할 수 없다** — 舊 "무작위 스위트" 결론은
철회한다. **원인은 여전히 미상**이라 해소 아님(scribe도 이번 재실행에서 미재현, 79/1050 전건 통과 —
저빈도 특성과 일치). ⚠️ scribe가 남긴 의문은 유효하다(다음 사람이 파고들 지점) — 부분 크래시 시 jest가
완주분만 집계할 수 있어 최종 스위트 크기와 크래시 시점 diff가 항상 같으리라는 보장은 없다(②·③의 일치가
우연일 가능성도 배제하지 않는다). 상세는 PIVOT-PLAN 대장 #217 행(규율 13 원문 보존 포함) 참조.

**다음 세션 할 일**: ① **대장 #224 실기 검증** — PR 오픈·머지·배포 후 센터 운영자가 프로덕션에 실제로
갇힌 콘텐츠(`01a09166-aac7-774e-b95b-5efc617d8a06`, 대장 #212)를 `upload-recover`로 복구 완주해야
'해소'로 바뀐다. ② **#225(기자 웹 공백) 판정** — QUEUE 편입 여부와 #224 UI를 그대로 이식할지 별도
설계할지. ③ #226~#229는 등재만 — 우선순위·QUEUE 편입 전부 조율자 판단 대기.

가변 값(정확한 PR 상태·머지 시각·테스트 계수)은 여기 적지 않는다 — 재현:
```bash
git log --oneline -3
git status --short
grep -rln "upload-recover\|recoverUpload" apps/reporter | wc -l
grep -n "센터 관제 웹" CLAUDE.md
node infra/scripts/daejang-recheck.mjs
node infra/scripts/controller-role-gate.mjs
```

### 열린 항목 (다음 세션이 알아야 할 것 — 판정 대기, QUEUE 편입 여부 미정)

- **대장 #216**(admin 술어 비대칭) — **수리 완료·PR 대기**(브랜치 `fix/upload-actor-predicate` 커밋
  `3627fa8`, 위 갱신 절 참조). 사용자 결정대로 `requireOwnerOrCenter`로 통일했고 컨트롤러 5라우트에
  `center_operator`를 열었다. **아직 PR·머지·배포 전** — 다음 세션이 PR 오픈부터.
- **대장 #217·#218·#220·#221**(2026-09-13 "업로드 경로 복구" 슬라이스가 드러낸 잔여 4건, 전부
  등재만) — QUEUE 편입 여부·순서 전부 판정 대기. **#217은 2026-09-14 조율자가 4회 중 1회, 2026-09-15
  슬라이스에서 2회 더, 2026-09-16 슬라이스에서 다시 2회 더**(위 "scribe 4차 갱신" 참조) 재현했다.
  실패 스위트를 처음 특정한 것은 `all-exceptions.filter.spec.ts`(원인 jest worker SIGSEGV)다.
  ⚠️ **舊 "무작위 스위트" 결론은 조율자 착오로 정정(2026-09-16)됐다** — 정정된 관측 계수 3회는
  **13건·8건·8건**(어디에도 "5건"은 없었다), 8건 차이 2회는 그 파일 크기와 일치하지만 13건 차이 1회는
  설명되지 않는다 — "무작위 스위트"도 "특정 파일"도 아직 단정할 수 없다. 원인은 여전히 미상이라 해소
  아님. 상세는 PIVOT-PLAN 대장 해당 행(규율 13 원문 보존).
- **대장 #219** — **해소(결함 아님, 2026-09-15)**. 위 갱신 절 참조. QUEUE §C-7도 함께 철회.
- **대장 #222·#223**(2026-09-14 신규 채번, 등재만) — #222(감시가 "머지한 PR이 실제로 main에
  들어갔는가"를 묻지 않는다, PR #103 사고에서 발견) · #223(Cloudflare 간헐 `error code: 1018`
  관측, 저등급). QUEUE 편입 여부 판정 대기.
- **대장 #224**(관제 웹 업로드 복구 UI 부재) — **수리 완료·PR 대기**(브랜치 `feat/upload-stall-recovery`
  커밋 `98aaf11`·`cb99969`, 위 "scribe 4차 갱신" 참조). **아직 PR·머지·배포 전** — 다음 세션이 PR
  오픈부터, 해소 판정은 프로덕션 실기 복구 완주가 조건이다.
- **대장 #225~#229**(2026-09-16 신규 채번, #224 수리 과정 파생, 전부 등재만) — #225(기자 웹에 같은
  API를 부르는 수단 0건) · #226(`/transitions` 범용 전이 고착 검사 없음, pre-existing) · #227(업로드
  액션 1차 게이트 테스트 미단언 구조적 갭) · #228(`api/contents.ts` wrapper URL 미검증, 기존 패턴)
  · #229(`ContentSummary`에 `updatedAt` 부재). QUEUE 편입 여부 전부 판정 대기. 상세는 PIVOT-PLAN
  대장 해당 행.
- **대장 #213**(해소, 2026-09-14) · **대장 #211·#212**(배포 완료·실기 검증 대기) — 각자의 수동 해소
  판정(위 "⭐⭐⭐⭐⭐ 지금의 다음 1건" 참조)이 다음 세션의 실질 착수 대상이다. **대장 #169**는
  재생·썸네일 축만 부분 해소(업로드 축은 #211 잔존), **대장 #214**는 해소 완료(위 참조).

- **대장 #207**(STT 로컬 전환 정본 정합, `grep -n "^| 207 " docs/plan/PIVOT-PLAN.md`) — QUEUE 3-3
  채번+7개 파일 24건 정정은 scribe가 2026-09-11에 완료했으나 **상태 칸은 "미수신"**이다. 다음 세션이
  확인할 것: ① 07-legal-license.md §3-10·§4·§6의 정정 문언이 법률적으로 정확한지(scribe는 판정
  권한 없음, 특히 "STT 국외이전 축만 소멸"이라는 판단이 07 §6 14항목 법률자문 계약(QUEUE §B B-2) 실
  착수 전에 스스로 옳은지 재확인) ② 05-monetization.md §B-1 비용표의 "재산정 필요(미실측)" 행이
  실제 로컬 STT 운영비(전기·하드웨어) 추정치로 채워질 필요가 있는지 — 지금은 의도적으로 비워 뒀다.
- **대장 #208·#209**(`grep -n "^| 20[89] " docs/plan/PIVOT-PLAN.md`) — PR #99 세션이 게이트②(독립
  검증)로 잡은 신규 결함 2건, **처방·QUEUE 편입 모두 미정(등재만)**. #208은 Mock 업로드 잔재
  `mock://placeholder`가 유령 미디어 방어 3계층 중 어디서 막히는지(서버 도달 없음 — UX+잔재 정리
  성격), #209는 "assertRealVideoInput이 최종 관문"이라는 과장 주석이 위임 지정 파일 밖
  (`draft-context.tsx:16-22`)에 하나 더 남아 있다는 것. 상세는 오늘(2026-09-11) 일간보고서 ③.
- **대장 #207(L601) 표 무결성 경고는 이 충돌 해소 세션에서 재실행하니 0건이었다** — PR #99 세션이
  보고한 "실제 9칸/헤더 7칸" 경고(`node infra/scripts/daejang-recheck.mjs`)가 지금은 재현되지
  않는다. scribe는 이번에도 PIVOT-PLAN.md 내용을 고치지 않았다(자동 병합만) — 원인은 단정하지
  않는다. 다음 세션이 재현 시 여전히 0인지 가볍게 확인해 둘 것(재발 가능성 배제 안 함).
- **대장 #201**(비밀번호 변경·재설정 기능 부재, `grep -n "^| 201 " docs/plan/PIVOT-PLAN.md`) — 채번만
  됐고 **QUEUE 편입 미정**이다. 조율자가 L3(정본에 자리가 없다) 성격으로 봤다. 동업자 테스트 계정
  공유 시도 중 실사용자가 직접 부딪힌 문제라 대기가 길어질수록 운영 부담이 커진다 — 다음 세션이
  QUEUE 편입 여부를 판정할 때 참고할 것.
- **QUEUE 새 1-1(가용성 감시)의 원리적 한계는 설계 전제다** — 배포 직후 1회 판정(舊 1-1, 이번에
  해소)은 그 이후의 되돌림을 원리적으로 못 잡는다(대장 #200이 실물로 증명). 이 한계 자체가 새
  1-1의 존재 이유이므로, 새 1-1을 설계할 때 "배포 시점 스모크의 상위 호환"으로 두지 말 것 — 다른 층
  (지속 폴링/외부 헬스체크)이어야 한다.
- **마커 검증은 형태만 보고 진실성은 못 본다**(위 §7-00000 상세) — `fake-99999999.sql.gz`도 통과한다.
  다음에 파괴적 마이그레이션이 생기면 승인 마커의 **내용까지** 사람이 다시 확인해야 한다(자동 게이트를
  전부 믿지 말 것).
- **스모크 라우트 목록이 이중화돼 있다** — `.github/workflows/build-images.yml` 인라인과
  `infra/scripts/deploy-smoke.mjs` 양쪽에 라우트 목록이 있다(SSH 전용 접근의 트레이드오프). 필수
  4종이 빠지면 exit 1로 방어되는 것은 확인됐으나, 라우트를 추가할 때는 **두 곳 모두** 갱신해야 한다.

### 사용자 대기 (일간보고서 ① 참조 — `docs/ops/daily/`)
① 카카오 실 송출 범위(QUEUE §D-2) — 2단계 완료 시 요청.
② **`9d2a9d8` 대기 런 2건 승인**(2026-09-06 요청, 오늘 일간보고서 ① 참조) — 확인:
`gh api "repos/HomeDCP/gachinol/actions/runs?status=waiting" --jq '.workflow_runs[]|{name,created_at}'`.
③ **C-4(Healthchecks.io)·C-5(외부 프로브) 개설**(QUEUE §C, 대장 #203 관련, 2026-09-06 요청) — S3
`monitor.yml` 머지 전 필요, 리드타임 각 30~45분.
~~④ **PR #102·#103 머지**(2026-09-13 요청)~~ — **2026-09-14 충족**: PR #102는 정상 머지·배포됐으나,
PR #103은 base였던 `fix/upload-path-recovery`로 잘못 머지되는 사고가 나 프로덕션에 반영되지 않았다.
조율자가 **PR #104**(동일 커밋 재제출, base=main)로 다시 머지·배포했다. 상세·교훈은 위
"⭐⭐⭐⭐⭐ 지금의 다음 1건" 참조.
~~⑤ **C-7(MinIO 라이프사이클 규칙)**(QUEUE §C, 대장 #219) — ⚠️ **지금이 요청 시점이다**(등재 시
"#103 머지 직전"으로 예고했는데 PR #104 머지로 멀티파트가 실제 트래픽을 받기 시작했다). `mc` 자격증명
필요.~~ — ❌ **철회(2026-09-15)**: 대장 #219가 해소(결함 아님)로 판정돼 요청 자체가 불요해졌다 —
MinIO가 미완성 멀티파트를 서버 기본값(`stale_uploads_expiry` 24h·`cleanup_interval` 6h)으로 이미
정리한다. 상세는 위 "⭐⭐⭐⭐⭐⭐ 갱신" 절·PIVOT-PLAN 대장 #219 참조.

⚠️ **머지마다 승인이 2회 필요하다(대장 #202가 등재한 바로 그 구조)** — main에 새 커밋이 올라갈
때마다 Build Images·Deploy Web 두 워크플로가 각각 `production` 환경 승인을 요구한다. **다음 세션이
머지를 한다면 머지 직후 이 승인 대기가 다시 생긴다는 것을 알고 있어야 한다.** 승인 대기 확인 명령:
`gh run list --branch main --json workflowName,status,conclusion,headSha -L 3` — 최신 headSha 3건이
`status:"waiting"`이면 사용자 승인이 필요한 시점이다(그날 일간보고서 ①에 올려 요청할 것, CLAUDE.md
§0-2).

**이미 받은 승인·완료된 요청(2026-09-14)**: PR #102 머지 승인(대장 #213·#212 배포) + PR #104 머지
승인(대장 #211 배포 — PR #103이 잘못된 브랜치로 머지되는 사고가 나 조율자가 동일 커밋을 PR #104로
재제출한 분). 상세·교훈은 위 "⭐⭐⭐⭐⭐ 지금의 다음 1건" 참조.

**이미 받은 승인·완료된 요청(2026-09-05)**: PR #94 머지분(headSha `1776c461`)의 배포 승인 2건 —
Build Images `deploy (api·media-worker·ai-worker → 제온)` + Deploy Web `deploy (정적 산출물 → 제온
web 컨테이너)`, 실배포까지 확인 완료(위 ⭐ 2026-09-05 항목 참조).

**이미 받은 승인·완료된 요청(2026-09-03)**: **배포 승인 2건**(GitHub Environment `production`
required reviewer 게이트를 실제로 통과 — Build Images 잡 `deploy (api·media-worker·ai-worker →
제온)` 승인 1건 + Deploy Web 잡 `deploy (정적 산출물 → 제온 web 컨테이너)` 승인 1건, `gh run view
--json jobs`의 `startedAt` 간격(build 종료 05:02 → deploy 시작 05:41, 약 39분)이 승인 대기의 정황).

**이미 받은 승인·완료된 요청(2026-09-02)**: `DROP COLUMN` 마이그레이션 적용 승인 · 배포 묶음(제온 SSH
풀스택 배포) 착수 승인 · **GitHub Environment 승인 게이트 설정**(QUEUE §D-1 완전 충족 — 위 "다음 1건"
참조) · **옛 Quick Tunnel systemd 정지**(대장 #199 해소 — `ssh 192.168.0.101 'sudo systemctl
disable --now gachinol-quick-tunnel.service'` 실행, 조율자 검증 `is-enabled`=`disabled`·
`is-active`=`inactive`). ~~Quick Tunnel 고정 방식~~은 2026-09-01 충족(named tunnel + `bapfull.com`,
QUEUE §C-1·D-3).

**⭐ 사업자등록 확보(2026-08-31)** — 사용자가 개인사업자 등록증(일반과세자, 업종에 "영화·비디오물
및 방송 프로그램 제작 관련 서비스업" 포함)을 제공했다. QUEUE §B-1(병렬 트랙 리드타임 항목)·대장 #185가
막던 선행 중 **사업자등록 자체**는 충족됐다 — 스토어 계정·카카오 비즈니스 인증·YouTube 수익화·
통신판매업·PG 개설 등 **후속 신고·계약은 별개로 남아 있다**(07 §6 "첫 촬영 재개 전" 14항목 완료와도
무관 — 계약 체결 단계가 아직 진행돼야 한다). ⚠️ 등록번호·대표자명·주소·생년월일 등 개인정보는
공개 리포에 적지 않는다(본 문서도 미기재). #185·QUEUE §B-1 판정은 조율자 소관이라 이 scribe
갱신에서는 상태 칸을 바꾸지 않았다 — **확인 필요 지점**으로 남긴다.

---

## 0. 그 전 세션 완료 — 기자 웹 실기 업로드 검증 (2026-08-30 · PR #78 · WORKLOG 정본)

**완주 실증**: 기자 웹 업로드(진행률 실상승 = T-W2-02 XHR 어댑터 실동작) → 트랜스코딩 → 자동편집
(edited_master) → 프리뷰 → 기자 승인 → 센터 승인 → 송출 → **`published` + 구독자 공개 피드 노출**
(전이 로그 전 구간·자산 5종 ready·durationSec 95 — api 실측). 舊 §0 체크포인트 ①②③ 전부 통과,
승인·송출은 사용자가 관제 웹 실기로 확인했다.

**과정에서 적발·해소한 배포·설정 결함 6건**(재현·수리 상세는 WORKLOG 2026-08-29 항목이 정본):
① 제온 nftables `inet filter forward`(policy drop)가 LAN→도커 발행 포트 포워딩을 전멸시킴 —
   Docker 자체 체인의 accept와 무관하게 최종 드랍(tcpdump+카운터로 확정) → `br-*` accept 런타임+영속 수리
② Actions vars `WEB_EXPO_PUBLIC_API_URL` 미설정 → 번들 API가 localhost — **`/`(상대 경로) 설정+재배포로
   舊 §0 "정본 불일치" 판정 종결**(nginx 주석의 상대 경로 전제가 참이 됐다 — 주석 정정 불요)
③ 제온 DOMAIN=localhost → 브라우저의 `*.localhost` 루프백 강제 해석으로 vhost 도달 불가 — gachinol.local 교정
④ WEB_ORIGINS 미설정 → 웹 쿠키 로그인 전면 차단(fail-closed 설계 기본값) — reporter·center 오리진 배선
⑤ S3_PUBLIC_ENDPOINT=localhost → presigned PUT이 브라우저 자기 호스트로 나가 즉사 — LAN IP 교정
⑥ media-worker 이미지 스테일(8/09 빌드) → auto_edit 잡 거부·preview_failed — GHCR 공개 전환+pull(8/28 빌드)

**잠복 코드 결함 1건 + 후속 4건을 대장 #168~#172로 채번**: #168 upload-complete 복구 비원자성
(실발생·수동 복원, **수리 대상**) · #169 터널 presign 구조 · #170 백엔드 이미지 스테일 ·
#171 상대경로 io('') 미실측 · #172 vars placeholder. 제온 호스트 측 수리 기록은 제온 /srv/admin/decisions.md.

차기 1순위는 이 세션이 선판정하지 않는다 — §2 후보 7건 + **#168 수리**를 다음 세션이 §6 규율로 재판정할 것.
→ **재판정 완료(2026-08-30, 아래 §2-R)**: 후보 7건 중 **3건이 선행 미충족으로 착수 불가**였고, 1순위는 **#168+#170 묶음**으로 판정했다.

## 1. 현재 위치

| 항목 | 값 | 재현 |
|---|---|---|
| main | `1776c461` (PR #94 머지 — "Merge pull request #94 from HomeDCP/feat/deploy-smoke-migration-gate") | `git fetch origin main && git log --oneline -1 origin/main` (§7-0 — 로컬 ref는 stale일 수 있다). ⚠️ 舊 기재 `6651666`(PR #92)는 PR #94 머지로 stale이 됐다 — 매 인계마다 재발하므로 착수 시 반드시 재실행할 것 |
| 열린 PR | **0**(#94 병합 완료) | `gh pr list --state open` |
| 대장 | **202행 / 대기 59**(2026-09-05 scribe 재실측 — #201·#202 신규 채번 2건이 대기로 편입, 해소 0. 총 행수 200→202) | 아래 §5 |
| 코드 태스크 | **46건 중 27 완료 · 19 미착수 (59%)** — **불변**(총량 재실행 확인 48, 값 동일) — grep 원값 **34**(舊와 동일). PR #94는 `.github/workflows/`·`infra/scripts/`·마이그레이션 승인 마커뿐(`git diff --stat 5a5d56e..1776c461 -- apps services packages` → 1파일=승인 마커, **코드 0줄**) — **E2 §C 코드 태스크 목록 밖**이라 이 모수에 편입되지 않는다 — 원값 불변이 진척 없음을 뜻하지 않는다(§5 마지막 경고와 동일 원칙) | 아래 §5 |

**착수 전에 이 네 줄을 먼저 돌린다.** 값이 다르면 이 문서가 stale인 것이므로, 문서를 믿지 말고 실측을 믿는다.

**2026-09-05 scribe 재실측 결과**(규율 1, PR #94 머지+대장 #202 채번 기록 직후): main
**1776c461**(舊 `6651666`에서 전진 — `git fetch origin main && git log --oneline -1 origin/main`
재확인, PR #94가 이 세션 이전에 이미 병합돼 있었다) · 열린 PR **0**(`gh pr list --state open`) ·
대장 행수 `awk 'NR>=380' docs/plan/PIVOT-PLAN.md | grep -oE "^\| [0-9]+ \|" | grep -oE "[0-9]+" |
sort -n | uniq | wc -l` → **202**(舊 200 + 신규 #201·#202) · `node infra/scripts/daejang-recheck.mjs`
→ **"대상 59행"**(舊 57 — #201·#202 신규 채번 2건이 미수신으로 대기 편입, 해소 0)·표 무결성
**0행**·어긋남 **0건**·일치 31(舊 29에서 #201·#202가 "일치" 자동 분류로 편입, 값 해석 대상은 아님) ·
수동 37 불변(#201·#202 자체는 명시적 등재-시점 기록이라 재현 명령이 값을 그대로 재현해 "일치"로
잡히고 수동 판정 목록에는 안 들어간다). 진행률 **원값 34/코드 태스크 27/46(59%) 불변**
(`grep -oE "^\| (\*\*)?T-W[0-9]-[0-9]+[a-z]?" docs/plan/exec/E2-work-breakdown.md | grep -oE
"T-W[0-9]-[0-9]+[a-z]?" | sort -u | wc -l` → **48** 불변. 매치 재확인은 세션 내 T-W 커밋 0건이라
생략 — PR #94는 `.github/workflows/`·`infra/scripts/`·마이그레이션 승인 마커뿐,
`git diff --stat 5a5d56e..1776c461 -- apps services packages` → 코드 0줄로 실측 확인).
**로컬 게이트**: `pnpm run test:scripts` → 6스위트 194/194 pass(이 세션 재실행 확인) ·
`pnpm lint && pnpm typecheck && pnpm test`는 값을 이 문서에 적지 않는다 — 착수 시 그 자리에서
재실행할 것(§1 원칙). **실배포 대조**: `curl -s https://api.bapfull.com/health/version`의 `sha`와
`curl -s https://watch.bapfull.com | grep -o '<meta name="build-sha"[^>]*>'`의 `content`가
`git log --oneline -1 origin/main`과 일치하면 배포=main. **승인 대기 확인**:
`gh run list --branch main --json workflowName,status,conclusion,headSha -L 3` — 최신 3건이 전부
`success`이면 대기 없음, `waiting`이 보이면 다음 세션이 사용자에게 승인을 요청해야 한다(위 "⭐
2026-09-05" 섹션·"사용자 대기" 절 참조).

**2026-09-03 scribe 재실측 결과**(규율 1, QUEUE 1-1 완주+대장 #200 기록 직후): main **6651666**(舊
`4368ba5`에서 전진 — `git fetch origin main && git log --oneline -1 origin/main` 재확인, PR #91·#92가
이 세션 도중 병합됐다) · 열린 PR **0**(`gh pr list --state open`) · 대장 행수 `awk 'NR>=380'
docs/plan/PIVOT-PLAN.md | grep -oE "^\| [0-9]+ \|" | grep -oE "[0-9]+" | sort -n | uniq | wc -l` →
**200**(舊 199 + 신규 #200) · `node infra/scripts/daejang-recheck.mjs` → **"대상 57행"**(舊 58 —
#180 해소로 대기 이탈, #200은 등재와 동시에 해소돼 대기 순증 0)·표 무결성 **0행**·어긋남 **0건**·
일치 29 불변·수동 38→**37**(#180이 보유하던 verify-pair 1개가 대기 이탈과 함께 빠진 결과). 진행률
**원값 34/코드 태스크 27/46(59%) 불변**(`grep -oE "^\| (\*\*)?T-W[0-9]-[0-9]+[a-z]?"
docs/plan/exec/E2-work-breakdown.md | grep -oE "T-W[0-9]-[0-9]+[a-z]?" | sort -u | wc -l` → **48**
불변 · 매치 재확인(while-read 루프, ⚠️ 이 리포 셸은 **zsh** — `for id in $IDS`는 zsh 기본 옵션에서
단어분리가 안 돼 루프가 1회만 돈다, `| while IFS= read -r id; do ...; done` 형태를 쓸 것) → **34**
불변, PR #91·#92는 `.github/workflows/`·`infra/scripts/` 배포 인프라라 **E2 §C 코드 태스크 목록
밖**(태스크 ID 매치 0)이라 이 모수에 편입되지 않는다).

**2026-09-02 scribe 재실측 결과**(규율 1, 사용자 실행 2건 기록 직후 — #199 해소 반영, D-1 판정 반영, 이력):
main **4368ba5**(舊 3f8e873에서 전진 — `git fetch origin main && git log --oneline -1 origin/main`
재확인, #88·#89가 이 세션 도중 병합됐다) · 열린 PR **0**(`gh pr list --state open` — #88·#89 모두 병합) ·
대장 행수 `awk 'NR>=380' docs/plan/PIVOT-PLAN.md | grep -oE "^\| [0-9]+ \|" | grep -oE "[0-9]+" | sort -n
| uniq | wc -l` → **199**(불변) · `node infra/scripts/daejang-recheck.mjs` → **"대상 58행"**(舊 59 —
#199 해소로 대기 이탈, 신규 채번 0)·표 무결성 **0행**·어긋남 **0건**(일치 29 불변·수동 40→**38**,
#199가 보유하던 verify-pair 2개가 함께 빠진 결과). 진행률은 위 표와 동일(불변, 총량 48만 재확인,
이번 슬라이스는 코드 태스크 목록 밖 — QUEUE D-1 판정도 문서 갱신이라 코드 변경 0).

**2026-09-02 scribe 재실측 결과**(규율 1, 배포 슬라이스 종료 기록 직후 — 이력, 위 값으로 교체됨):
main **3f8e873**(불변, `git fetch origin main && git log --oneline -1 origin/main` 재확인 — #88·#89는
아직 열린 PR이라 main 미반영) · 열린 PR **2**(`gh pr list --state open` — #88·#89) · 대장 행수
`awk 'NR>=380' docs/plan/PIVOT-PLAN.md | grep -oE "^\| [0-9]+ \|" | grep -oE "[0-9]+" | sort -n | uniq
| wc -l` → **199**(불변 — #199는 이번 세션 전에 이미 등재돼 있었다) · `node infra/scripts/daejang-recheck.mjs`
→ **"대상 59행"**(舊 62 — #170·#194·#195 3건이 해소로 대기 이탈, 신규 채번 0)·표 무결성 **0행**·
어긋남 **0건**(일치 31→**29**·수동 44→**40**, 둘 다 해소된 3행이 각자 보유하던 verify-pair가
함께 빠진 결과 — #195는 pair 2개를 갖고 있었다). 진행률은 위 표와 동일(불변, 총량 48만 재확인,
이번 슬라이스는 코드 태스크 목록 밖).

**2026-09-02 scribe 재실측 결과**(규율 1, #189 종료 기록 슬라이스 직후 — 이력, 위 값으로 교체됨): main **3f8e873**(PR #87, `git
fetch origin main && git log --oneline -1 origin/main` 재확인) · 열린 PR **0**(`gh pr list --state open`) ·
대장 행수 `awk 'NR>=380' docs/plan/PIVOT-PLAN.md | grep -oE "^\| [0-9]+ \|" | grep -oE "[0-9]+" | sort -n |
uniq | wc -l` → **198**(舊 197 + 신규 #198) · `node infra/scripts/daejang-recheck.mjs` → **"대상 61행"**·
표 무결성 **0행**·어긋남 **0건**(舊 어긋남 1건이던 #189가 이번 슬라이스로 해소돼 대기 이탈, #198이 신규
미수신으로 대기 편입 — 대기 총량 순변화 0(61→61), 일치 28→**29**·수동 41 불변). 진행률은 위 표와 동일
(불변, 총량 48만 재확인).

**2026-09-01 scribe 재실측 결과**(규율 1, 인터넷 경로 개통 슬라이스 직후): main **99c1e4f**(PR #84, `git
fetch origin main && git log --oneline -1 origin/main` 재확인 — 로컬 HEAD와 일치) · 열린 PR **0**
(`gh pr list --state open`) · 대장 행수 `awk 'NR>=380' docs/plan/PIVOT-PLAN.md | grep -oE "^\| [0-9]+ \|"
| grep -oE "[0-9]+" | sort -n | uniq | wc -l` → **195**(舊 192 + 신규 #193·#194·#195) · 대기
`node infra/scripts/daejang-recheck.mjs` → **"대상 59행"**·표 무결성 **0행**·어긋남 **0건**(舊 60에서
#179·#187·#172 3건이 해소로 빠지고 #194·#195 2건이 신규 미수신으로 들어와 순변화 -1). 진행률
`grep -oE "^\| (\*\*)?T-W[0-9]-[0-9]+[a-z]?" docs/plan/exec/E2-work-breakdown.md | grep -oE
"T-W[0-9]-[0-9]+[a-z]?" | sort -u | wc -l` → **48**(불변), 매치 `git log origin/main --grep="<ID>"
--pretty=%s | grep -qE "^(feat|fix|refactor|perf)"` 48건 개별 재확인 → **34**(불변) → 27/46(59%) 불변.

**2026-09-01 scribe 재실측 결과**(규율 1, #182 슬라이스 문서 정리 직후): 열린 PR **0**·main **8301eae**(PR #82)·
대장 **192행/대기 60·어긋남 0**(`node infra/scripts/daejang-recheck.mjs` 재실행 — "대상 60행(대기분, 상태 칸 보유
표 전건 259행 중)" 출력, 표 무결성 0행. 총 행수는
`awk 'NR>=380' docs/plan/PIVOT-PLAN.md | grep -oE "^\| [0-9]+ \|" | grep -oE "[0-9]+" | sort -n | uniq | wc -l` → **192**,
번호 결손·중복 없음(舊 190 + 신규 #191·#192). 대기 60은 舊 190행/대기64에서 이번 슬라이스가 #182·#87·#103을
미수신에서 해소/부분해소로 옮겨(-3) + #191·#192는 처음부터 해소 상태로 등재돼 대기 미증가(+0)한 결과다 —
산술상 64-3=61인데 실측은 **60**으로 1건 차이가 있다. ⭐ **조율자 판정(2026-09-01)**: 이 차이를 재구성하지
않는다 — **舊 64는 고장 난 도구(범위 결함·표 분절·기대값 문법 미규정)가 낸 값**이고, 이번 슬라이스가 고친
것이 정확히 그 고장이다. 파서가 정확해지면 목록이 바뀌는 것이 정상이며 **舊 값과의 산술 정합을 맞추려는
시도 자체가 무의미**하다(舊 64는 대조 대상이 아니다). ⚠️ **舊 문언 정정(2026-09-01, 규율 13 — 이력 보존)**: 이전 기재는
"상태 칸만 뽑는 §5의 awk 명령이 비표준 열 수를 가진 9개 행(#85·#149·#155~161)에서 오분열돼 신뢰할 수 없었고,
정확한 '미수신' 단일값은 확정 불가(파서마다 62~64 사이에서 갈린다)"였다. **대장 #182 해소(표 물리 복구 +
전 조각 검사)로 이 사정이 바뀌었다** — `node infra/scripts/daejang-recheck.mjs --all` 재실행 결과 **표 무결성
0행**(259행 전건, §6-11 물리 분절 표 포함)이며, 이 스크립트의 pending 판정 60이 이제 유일한 신뢰 값이다.
**다만 §5의 舊 awk 명령(`-F' \| '`, 셀 안 이스케이프 무인지)은 여전히 신뢰하지 말 것** — 표 물리 복구가
이스케이프 자체를 없앤 게 아니라 칸 구조만 정상화했으므로, 스크립트가 아닌 awk 단독 재현은 여전히 오분열
위험이 있다. **정본 재현 명령은 `node infra/scripts/daejang-recheck.mjs`(이스케이프-인지 파서) 하나로 고정한다.**
진행률 **원값 34/코드 태스크 27/46(59%) 불변**(§5 명령 재실행 확인, 이번 슬라이스가 모수 밖이라 무변동이
기대된 결과와 일치) — **main·대장 두 줄만 갱신**이고 진행률은 계산 방법을 재확인한 결과(값 불변)다.

**2026-08-30 재판정 세션 실측 결과**(규율 1, 이력 — 위 2026-08-31 값으로 교체됨): 열린 PR **0**·대장 **172행/대기 47·어긋남 0**(`daejang-recheck.mjs`)·
진행률 **원값 34/미매치 14**(검산: 미매치 14 + 잔여 오검출 5 = 미착수 19) — **main 한 줄만 stale**이고 나머지 3줄은
기재값 그대로였다. 리포는 **shallow가 아니다**(`git rev-parse --is-shallow-repository` → false — 로컬 맥 세션에서는
§7-0의 `--unshallow` 선행이 불요. CCR 리모트에서만 필요하다). 잔여 오검출 5건 중 **T-W1-11b·T-W2-17·T-W4-02는
이번에도 산출물 부재로 재확인**했다(`ci.yml` 잡은 `node`·`ai-worker` **2개뿐** — Lighthouse·Playwright 문자열 0건).
**CI는 워크플로 3종(CI·Build Images·Deploy Web) 최근 머지 전건 success**(규율 15) — 착수 차단 없음.

## 2. 지금 갈 수 있는 것 (재판정 완료 — 실제 착수 가능은 **4건 + #168**)

> **2026-08-30 재판정**(§6 규율 5·10·13·15 적용). 舊 §2는 후보를 **7건**으로 적었으나, 선행 의존을
> **실구동 기준**으로 재보니 **3건(T-W2-07·T-W3-01·T-W3-02)이 착수 불가**다. 舊 표의 비고는 각 태스크의
> *난이도·동반 의무*만 적었을 뿐 **선행 충족 여부를 적지 않았다** — 그래서 착수 불가 3건이 후보로 서 있었다.

### 2-A. 착수 가능 (선행 실구동 충족)

| 태스크 | 규모(실측) | 선행 충족 근거 | 착수 시 동반 의무 |
|---|---|---|---|
| **#168** 수리 | **S~M**(api 2파일 + 회귀 테스트) | 수리 선례가 리포에 실재 — tx 주입형 hop `resumePublishing(tx, content, user)`·`db: Prisma.TransactionClient = this.prisma` 기본인자(`resident-reviews.service.ts:286`). 테스트 자리도 실재(`upload.service.spec.ts` 현 7건) | **대장 #170 동반 필수**(아래 §2-R) |
| T-W1-07a | **M**(4파일) | ✅ 서버·계약·토큰이 전부 **실구동**: `TelemetryModule` 등재 + `@Public() @Post('events')` + `telemetry.service.ts`가 `PlaybackStart`·`PlaybackProgress`·`LargeCaptionToggle` 롤업까지 구현 · shared 카탈로그 · `packages/ui` `typoLarge`(22/24/26px). **발신자만 0** | 대장 **#131 잔여분**이 정확히 이것 — KPI "조회 집계"·"큰 자막 모드 활성 비율"이 현재 구조적으로 영원히 0/null · `send-events.ts`(sendBeacon) 재사용 여부 판단 · E3:190 엣지 `T-W1-07a ─ T-W1-11a` |
| T-W2-05 | **XL**(실측 **28**파일 — 舊 기재 21) | ✅ T-W1-01 실구동(`packages/ui/src/tokens.ts`+`tokens.css`, 3앱 `package.json`에 `workspace:*` 선언, subscriber 10+파일이 런타임 소비 중) | 대장 **#67**(reporter `global.css`에 `@import tokens.css` 2단 배선 — T-W1-02 선례대로면 **+2파일 = 30**) · 대장 **#68**(아래) |
| T-W2-06 | **XL**(실측 **21**파일 — 舊 기재 17) | ✅ 위와 동일. E3 엣지의 `T-W2-16b` 선행은 **기능 의존이 아니라 같은 `live/[id].tsx` 중복 편집 회피용 순서 분리** | 대장 **#67**(+2 = 23) · 대장 **#68** |
| T-W2-18 | **S**(2파일) | ✅ 선행 없음. 부수 이득 — "정밀 모드 한정" 조건이 **구조적으로 이미 충족**(간단 모드는 `scenes.tsx`를 아예 거치지 않는다) | ⚠️ **정본 전제 2건이 깨져 있다 — 착수 전 판정 선행**(아래 §2-R ③) |

### 2-B. 착수 불가 (선행 미충족 — 舊 §2가 후보로 잘못 세워 둔 3건)

| 태스크 | 착수 불가 사유(실측) |
|---|---|
| T-W2-07 | E3:479 선행이 **"Wave 4~14 전건"**인데, 그 안에 §4 **착수 금지 4건**(T-W2-03·15·16a·16b)이 들어 있다 — 지출·사람 트랙이라 코드로 못 연다. 여기에 T-W2-05·06도 미착수. **舊 §2는 "한 세션을 통째로 쓸 것"이라 적어 규모 문제로만 보이게 했으나, 실제로는 규모가 아니라 선행이 막는다** |
| T-W3-01 | 선행 미충족 **2축**: ① Wave 13b(W1 코드 종료)인데 T-W1-11a·11b 커밋 0건 ② **T-NC-08**(Apple Developer 조직 계정 = D-U-N-S 선행 + Play Console) — E1 §A가 *"사용자 본인 인증이 필요한 행위의 대행 불가"*로 못 박았고 **리드타임 8주**. 舊 §2의 "T-W3-03·04의 선행"은 사실이나 **자신의 선행은 적지 않았다**. ⚠️ **사실 정정(2026-09-01, 규율 13 — 원문 보존)**: "D-U-N-S 선행· 8주"는 소멸했다 — 사용자가 개인사업자로 시작해 Apple은 individual 계정(D-U-N-S 불요, W3 착수 무렵 충분), 대신 Google Play 개인 계정 트랙에 **"W3 코드 완료 후 최소 14일"**이 새 크리티컬 패스로 생겼다. "사용자 본인 인증이라 대행 불가"라는 축은 그대로다(07 §6 "스토어 계정 개설" 블록) |
| T-W3-02 | ① E3:224가 **`T-W3-01 ─ T-W3-02`**로 확정(舊 §2는 둘을 나란히 후보로 뒀다) ② 대장 **#141(미수신)**: *"Workbox 툴체인 전량 도입이 불가능하다"* — `Dockerfile.web`이 `expo export`를 직접 호출해 `workbox-build` 후처리 단계가 없다. **舊 §2의 "T-W1-04 기반 존재"는 맞지만 그 기반이 `workbox-window` 1개 + 수기 `sw.js`라는 사실이 빠졌다** ③ 경로 규약 불일치(아래 §2-R ④) |

**후보 밖 12건의 내역**(미착수 19 − 舊 후보 7, 2026-08-28 명시): §4 착수 금지 **7건**
(T-W2-15·16a·16b·T-W2-03·T-W1-11a·T-W3-03·T-W3-04) + CI 배선 **2건**(T-W1-11b Lighthouse ·
T-W2-17 Playwright — 후자는 T-W2-07이 동반 소유) + W4 정리 단계 **3건**(T-W4-01·02·03).
셋 다 §1 오검출 목록과 겹치므로(11b·17·4-02) **"오검출 = 곧 후보"가 아니다** — 단계·차단을 먼저 본다.
⚠️ 이번 재판정으로 **역도 참임이 드러났다**: "미착수 = 곧 후보"도 아니다. T-W2-07·T-W3-01·T-W3-02는
§4 착수 금지 목록에 없어서 후보로 올라왔지만, **선행을 실구동으로 따지면 셋 다 막혀 있다.**

## 2-R. 재판정 결과 — 차기 1순위는 **#168 + #170 묶음**

**판정**: 착수 가능 5건 중 **#168 수리 + #170 제온 백엔드 배포**를 한 세션으로 묶는 것을 1순위로 한다.

1. **#168은 유일한 "실발생·재발 가능" 결함이다.** 규율 10대로 대장의 진단 자체를 코드로 검증했고 **3항 전부 확인**:
   ① `upload.service.ts:90-91`의 `assets.markFailed` → `workflow.failUpload`가 무-트랜잭션 2쓰기
   ② `media-assets.service.ts:147` `findOriginal`이 `status: { not: 'failed' }` — 한 번 failed면 완료 경로가 null을 쥔다
   ③ `upload.service.ts:12` `ISSUABLE = ['draft','upload_failed']` — `uploading` 고착은 재발급 409
   ⇒ **재발급 409 + 완료 409/validation_failed로 양쪽이 다 막히는 영구 교착**이 성립한다. 나머지 4건은 기능 부재이지 결함이 아니다.
2. **#170을 떼면 #168 수리가 실기에 도달하지 못한다.** 제온 실측: `gachinol-api:latest`가 **8/21 빌드(9일 스테일)**,
   `gachinol-ai-worker:latest`는 **8/09 빌드(21일)**. GHCR `:latest`는 main 머지마다 갱신되므로
   (`build-images.yml`의 `type=raw,value=latest,enable={{is_default_branch}}`) 수리 자체는 제온 `compose pull + up` 1회다.
   ⚠️ 그러나 **미적용 마이그레이션 `20260827203549`가 `DROP COLUMN` 2개(비가역)**다 —
   `contents.minor_consent_confirmed_at`·`..._by_user_id`. **사용자 승인 없이 적용하지 말 것.**
   복원점은 확보돼 있다(`gachinol-backup.timer` 가동 중, 최신 PG 덤프 `/mnt/gachinol-backup/pg/gachinol-20260830-040644.sql.gz`).
3. **T-W2-18은 착수 가능하나 정본 전제 2건이 깨져 있다** — 착수 전 판정이 선행이다:
   ① **원자재가 2/6만 있다**: 03 §C-2-2가 6종 템플릿을 01 §C-1·§C-8 소유로 넘겼는데 01 §C-8 체크리스트가 **미완**이고
   담당이 **비개발 트랙(콘텐츠 제작 가이드 담당)**이다. 코드에도 없다(shared·api의 `checkSceneOrders`는 order 중복·연속성
   **검증 함수**이지 권장 템플릿이 아니다).
   ② **위저드 순서와 충돌한다**: §C-2-2는 *"선택된 카테고리에 대응하는"* 카드를 요구하는데, T-W2-34(대장 #123)가
   순서를 `촬영→모드→자막(scenes)→분류(classify)→업로드`로 바꿔 **`scenes` 단계에서 `category`가 `undefined`**다.
4. **T-W2-05·06(XL 2건)은 대장 #68 사이징 재판정이 선행이다** — #68 기재값 23건이 **실측 48건**으로 2배 이상 늘었다(아래 §2-S).
5. **2순위는 T-W1-07a**(M, 선행 실구동 충족, 대장 #131 잔여 해소). 서버가 미지의 이벤트 이름을 400이 아니라 조용히 버리므로
   이 공백은 **어떤 실패도 내지 않는다** — 그래서 오래 남았다.

## 2-S. 이번 재판정이 정정한 기록치 (규율 1·13)

| 대상 | 舊 기재 | 실측(2026-08-30) | 조치 |
|---|---|---|---|
| HANDOFF §1 main | `e490130`(PR #78) | `2e02065`(PR #79) | 본 문서 정정 |
| 대장 #168 비고 | "교착 실물 **1건 잔존**(contents `01a04de0` **uploading**)" | 해당 콘텐츠 status = **`upload_failed`** → **잔존 0건**(수동 복원이 이미 적용됨. `upload_failed`는 ISSUABLE이라 재발급으로 복구 가능) | 대장 정정 |
| 대장 #170 | api 스테일만 명시 | **ai-worker도 8/09 빌드(21일)** | 대장 보강 |
| 대장 #68 | lineHeight 하드코딩 **23건/11파일** | **48건/20파일**(reporter 25·control-center 13·**subscriber 10**) | 대장 정정 |
| 대장 #68 상태란 | "subscriber 1건은 T-W1-02가 흡수해도 사이징 불변" | **T-W1-02 완료 후에도 subscriber 10건 잔존** · `packages/ui`에 `lineHeight` 토큰이 **아예 없다**(0건) → 어느 태스크도 소유하지 않는 공백 | 대장 정정 |
| E2 T-W2-05 소비파일 | 20 | **27**(`app/` 14·`src/features` 4·`src/ui` 9) | E2 정정 |
| E2 T-W2-06 소비파일 | 16 | **20**(`app/` 9·**`src/features` 3**(E2 내역 누락)·`src/ui` 8) | E2 정정 |
| 대장 #71·#72 | — | 셀 안 파이프 미이스케이프로 **칸 밀림**(11칸·8칸, 기준 9) | 정정(#71 실상태는 "수신 완료"라 **대기 47 총계는 안전**) |
| 대장 #72 재현 명령 | `find infra -iname "*.sh" \| wc -l` → 해소 후 ≥2 | 이스케이프를 고치자 명령이 실행돼 **≥2 충족** — 그러나 2번째 `.sh`는 무관한 백업 스크립트(`media-to-nas.sh`)이고 **결함 본질인 `infra/monitoring/*.sh`는 0건 · `implemented` 7건 전부 `false`** | 명령을 `grep -c '"implemented": true' infra/monitoring/uptime-kuma-alerts.json` → 7로 교체 |

## 3-0. 직전 완료 — T-W2-02 기자 웹 업로더 XHR 어댑터 (2026-08-28, PR #75)

**기자 웹에서 업로드 자체가 동작하지 않던 기능 부재가 닫혔다.** `http-upload-service.ts`가
`expo-file-system/legacy`(네이티브 전용) **단일 경로**여서 — Platform 분기도 웹 폴백도 없었다 —
화면 측(진행률·AbortController·재시도)이 완비돼 있는데도 웹에서는 아무것도 올라가지 않았다.
이 공백은 **언급-오검출 정정으로 드러났다**(§7-0 — "T-W2-02 미착수라"는 타 커밋 본문이 완료로
오계상되어 W2 목표 한복판의 구멍이 가려져 있었다). 착수는 AskUserQuestion으로 사용자 확정.

- 신규 2 + 수정 1: `xhr-upload-service.ts`(XHR presigned PUT 로직, 주입형 — jest가 `.web.ts`를
  해석하지 않으므로 구독자 `dom-uploader.ts`와 동형으로 분리) · `http-upload-service.web.ts`
  (Metro 웹 해석 진입, **같은 이름 export**라 `useUploadService()` DI 지점 무변경) ·
  `http-upload-service.ts`(`notifyUploadFailed` 이동 — 웹 해석 순환 회피 + 복구 의미론 사본 0).
- 설계 고정 3: ⓪ 본문을 ①(upload-url)보다 **먼저** 읽어 읽기 실패 시 서버 무접촉(draft 유지) ·
  `sizeBytes`는 **실측 Blob 크기 우선**(웹 픽커가 fileSize를 안 주면 호출부가 0을 보내 서버
  zod `positive()`에서 ①부터 400) · 에러에 상태코드만(presigned 서명 URL 비유출).
- 검증: 신규 8 테스트(TDD 레드 선행) · reporter **299/299**(기준선 291+8) · typecheck·lint 0 ·
  **번들 스왑 실증**(웹 번들 `createUploadTask` **0건** = 네이티브 경로 소거) · E2 판정 grep 5(등재 시 0).
- **머지분 main 런 #49 deploy 잡 success**(11:23:55, 제온 web 컨테이너 갱신). purge만 의도된 skip.

**실기 확인 완료(2026-08-30)** — §0 참조: 업로드 한 바퀴가 `published`·공개 피드 노출까지 완주했다.

## 3. 그 전 완료 — T-W2-35 주민 링크 발급 UI (2026-08-28, PR #73 · 대장 #147)

**03 §C-5 주민 공급 경로의 마지막 실사용 공백이 닫혔다** — 서버 발급 API·주민 소비 화면(T-W2-09)은
완비인데 **발급 화면이 0건**이라 경로 전체가 실사용 불가이던 것. `apps/reporter` 발급 화면
(`app/(app)/resident-uploads/issue.tsx`) + 검수 목록 진입 버튼 + 공유 URL 구성(`<구독자 오리진>/upload/<token>`
— env `EXPO_PUBLIC_SUBSCRIBER_WEB_URL` 우선, `reporter.`→`watch.` 호스트 유도 폴백, 불가 시 경로
표시로 정직 강등) + 토큰 1회 노출 경고(서버 해시 보관·재조회 불가). 신규 공개 키는 #146 규칙대로
3점 배선(`.env.example`·`Dockerfile.web`·`deploy-web.yml`). reporter **291/291**(기준선 280+11) ·
qa-verifier **AC 5/5 PASS**. 같은 PR에서 #147 재현 명령 정정(규율 17)·HANDOFF 사실 결함 2건 정정.

**⭐ 머지분 main 런 deploy 잡 success 실측(2026-08-28, Deploy Web 런 #46)** — 신규 build-args 줄
(`EXPO_PUBLIC_SUBSCRIBER_WEB_URL`)이 **실배포 경로를 처음 탄 런**이다. 규율 15대로 잡 단위 확인:
preflight → build(번들 예산 게이트 포함) → **deploy(제온 SSH compose pull+up) 전부 success**,
purge만 도메인 보류로 의도된 skip. Actions vars `WEB_EXPO_PUBLIC_SUBSCRIBER_WEB_URL` 설정 여부는
미확인 — 미설정이어도 발급 화면은 경로 표시+안내로 정직 강등되므로 차단 아님(§8).

> 그 이전 완료분(T-W2-36 동의서 판단 게이트 해체 PR #71 · T-W2-14 PR #67 등)은 WORKLOG와
> 대장(#166·#118)이 단일 원천이다. **main 머지 = 제온 웹 자동 배포**는 그때 가동돼(PR #71 머지분
> 런에서 deploy 잡 첫 success) 이후 전 머지에서 유지되고 있다 — CLAUDE.md §12·대장 #165 참조.

## 4. 막혀 있는 것 (착수 금지)

| 태스크 | 차단 사유 |
|---|---|
| T-W2-15 · 16a · 16b | **T-NC-20 CF Stream 실계정** — 지출 발생, 사용자 지시 "지출 0 유지"와 충돌 |
| T-W2-03 | **T-NC-03 PoC** — 실기기 18시행, **사람이 해야 한다** |
| T-W1-11a · T-W3-03 · T-W3-04 | 선행 태스크 미완 |
| **T-W2-07 · T-W3-01 · T-W3-02** | **2026-08-30 재판정으로 편입**(§2-B가 근거 원문) — 舊 §2가 후보로 세웠으나 선행 미충족이다. T-W2-07 = Wave 4~14 전건 선행 안에 착수 금지 4건 포함 · T-W3-01 = W1 코드 미종료 + **T-NC-08(사용자 본인 인증·리드타임 8주)** · T-W3-02 = E3상 T-W3-01 선행 + 대장 **#141**(Workbox 전량 도입 불가) |
| 대장 **#115** | 07 §3-15 외부 법률자문 대기 — **임의 구현 금지**(EXEC-DECISIONS #30) |
| 대장 **#162** | **#163 선행** — `origin='live_vod'` Content를 만드는 코드가 0이다 |

## 5. 재현 명령

```bash
# 대장 대기 건수 — 상태 칸(뒤에서 두 번째)만 센다. 행 전체 grep은 본문 단어까지 세어 틀린다(#159)
awk -F' \| ' '/^\| [0-9]+ \|/ {print $(NF-1)}' docs/plan/PIVOT-PLAN.md | grep -c <대기상태문자열>

# 대장 행수 / 번호 중복
awk 'NR>=380' docs/plan/PIVOT-PLAN.md | grep -oE "^\| [0-9]+ \|" | grep -oE "[0-9]+" | sort -n | uniq | wc -l

# 대장 재현 명령 일괄 대조 + 표 무결성 검사 (읽기 전용)
node infra/scripts/daejang-recheck.mjs
```

진행률(코드 46건 기준)은 구현 커밋(`feat|fix|refactor|perf`)에 태스크 ID가 등장하는지로 판정한다.
ID 열거는 **E2 §C 표 행 기준**으로 한다(2026-08-28 정정 — 파일 전체 grep은 유령 언급 T-W1-07c·분할
부모 3건까지 주워 舊 "49→46" 보정이 필요했다. 행 기준이면 그들은 애초에 안 들어오고 **48행**이 나온다):

```bash
# ① ID 열거(행 기준) → 48  ② ID별 구현 커밋 판정 → 매치 수가 grep 원값(2026-08-28 실측 34)
grep -oE "^\| (\*\*)?T-W[0-9]-[0-9]+[a-z]?" docs/plan/exec/E2-work-breakdown.md | grep -oE "T-W[0-9]-[0-9]+[a-z]?" | sort -u
git log origin/main --grep="<ID>" --pretty=%s | grep -qE "^(feat|fix|refactor|perf)"
```

⚠️ 원값 34 = 실구현 29 + 언급-오검출 5(§7-0·§7-1). 실구현 29에서 **모수 밖 신설 2건**(T-W2-19·T-W2-35 —
행 48 > 선언 46의 차이가 정확히 이 둘이다. `34d1903^` 시점 행수 46으로 실증)을 빼면 **27/46**.
⚠️ 이 판정은 **커밋에 태스크 ID를 적었다는 전제**다 — 안 적고 구현하면 과소 계상된다.
⚠️ **shallow clone에서 돌리면 조용히 과소 계상된다**(§7-0) — `git fetch --unshallow` 선행.
⚠️ **오검출로 이미 매치되던 태스크를 실제로 구현하면 원값이 안 움직인다** — T-W2-02 머지 전후로
원값은 34 그대로이고 실질만 26→27이 됐다(실측 2026-08-28). **원값 불변 = 진척 없음이 아니다.**
그래서 판정은 항상 원값이 아니라 **오검출 목록을 뺀 뒤**에 한다.

## 6. 착수 전 필수 확인 (규율)

1. **의존 계약이 실제로 구동되는지 확인한다**(규율 5). 타입·픽스처·테스트만 있는 것은 구동이 아니다.
   → 2026-08-23 #162가 이걸로 막혔다: 계약·가드·전이맵이 다 있는데 **그 origin의 Content를 만드는 코드가 0**이었다.
2. **대장의 진단 자체를 검증한다**(규율 10). "수신처" 열은 진단이지 처방이 아니다.
3. **정본(계획 문서) 문언까지 읽고, 틀렸으면 보고 후 고친다**(규율 13, 사용자 승인된 권한).
4. **CI는 워크플로 단위로 확인한다**(규율 15). `node`가 초록이어도 `build-images`가 빨갈 수 있다
   → 2026-08-21~23에 실제로 **배포가 3일간 막혀 있었다**(#161).
5. **수치는 그 자리에서 재실행**한다(규율 1). 이 문서 §1 포함.

## 7-000000. 2026-09-12 세션(PR #100 반영 + 실기 검증 5건, scribe)이 남긴 함정

- **배포 신선도는 라우트를 잘못 고르면 거짓으로 통과한다.** `/health/version`(무프리픽스)과
  `/v1/health/version`은 **서로 다른 배포 세대에 존재하는 별개 라우트**다 — 후자는 舊(2026-09-02
  이전) 코드에만 있고, 전자는 그 뒤 `setup-app.ts`가 `v1` 전역 프리픽스에서 명시적으로 뺀 현재
  코드에만 있다. 舊 이미지가 다시 떠 있으면 `/v1/health/version`은 **200과 함께 그럴듯한 SHA를
  반환**하므로(그 이미지 시점 기준으로는 맞는 값이라) 프리픽스를 안 가리면 "배포 최신"으로 오판한다.
  **항상 `/health/version`(무프리픽스)으로 먼저 확인하고, 404가 나오면 그 자체가 구세대 이미지의
  증거**다.
- **`docker compose ps`(CI 배포 로그 안)의 성공은 그 순간의 참일 뿐이다** — 배포 몇 분 뒤 별도
  경로(수동 SSH 등, GitHub Actions 워크플로 런에 안 잡힘)로 컨테이너가 재생성되면 조용히 되돌아갈
  수 있다(대장 #200과 같은 부류의 사각, 이번엔 워크플로 간 충돌이 아니라 수동 개입으로 추정 —
  QUEUE.md 1단계 각주가 예고한 "배포 직후 1회 판정의 원리적 한계"가 다시 실증됐다). 위 "⭐⭐⭐
  지금의 다음 1건" 절의 발견 참고.
- **production DB SSH 조회는 매번 통과를 보장하지 않는다** — 같은 계정·같은 호스트에 대한
  `docker exec ... psql ...` 조회가 첫 시도(특정 content id로 좁힌 SELECT)에서는 권한 시스템
  분류기에 차단됐고, 곧바로 이어진 재시도(같은 내용, 인용부호만 다르게 구성한 aggregate 쿼리)는
  통과했다 — 패턴이 불명확하다. 차단되면 무리하게 우회하지 말고 코드 레벨 증거로 대체하거나
  "확인 불가"로 남길 것(이번 세션은 재시도로 통과했지만 다음 세션은 다를 수 있다).
- **Bash 명령 텍스트에 `.env` 문자열이 있으면 guard.sh가 맥락과 무관하게 차단한다** — 실제로
  그 이름의 파일을 읽거나 쓰지 않고, 그냥 문서 **산문**에 "제온 `.env`의 `S3_PUBLIC_ENDPOINT`"라고
  적으려 한 Bash heredoc조차 차단됐다(이 절 자신의 초고를 쓰다가도 재발했다). 이 리포의
  절대규칙("`.env*`를 읽지 않는다")과는 다른 층의 차단(파일 접근이 아니라 문자열 매칭)이다 — 문서에
  이 개념을 적어야 하면 "제온 설정값 `S3_PUBLIC_ENDPOINT`"처럼 리터럴 토큰을 피해 쓰거나, Bash 대신
  Edit 도구로 직접 기입할 것(Edit은 이 차단을 타지 않았다).
- **Cloudflare 커뮤니티 포럼(`community.cloudflare.com`)은 curl을 UA 무관하게 403으로 막는다** —
  봇 차단으로 추정되지만 링크 자체가 깨졌다는 뜻은 아니다. 그 사이트를 근거로 인용할 때는 "curl
  재현 불가(403, 포럼 자체 봇 차단 추정)"라고 정직하게 적고 원 주장의 진위를 과장하지 말 것.

## 7-00000. 2026-09-05 세션(PR #94·대장 #202)이 남긴 함정

- **승인 게이트 검증은 형태만 보고 진실성은 못 본다.** 파괴적 마이그레이션 승인 마커에 "규율 21
  방지"를 표방한 헤더 주석이 있었지만 실제로는 빈칸만 막았다 — `-`·`n/a`·같은 글자 반복이 전부
  통과했다. 도메인 신호(수치+단위, 백업 파일 식별자)를 강제해도 `999행 확인`·`fake-99999999.sql.gz`
  같은 **그럴듯한 거짓**은 여전히 통과한다(PR #94 본문이 이 한계를 스스로 명시했다). **정규식 게이트에
  "진실성"을 기대하지 말 것** — 실질 방어는 마커가 PR diff에 드러나 사람이 본다는 것뿐이다.
- **하나의 배포를 두 워크플로로 쪼개면 승인도 둘로 쪼개진다.** #200(증상: `up`이 의존 서비스를 함께
  건드려 되돌림)을 고쳐도 **원인(워크플로가 둘이라는 구조)은 그대로**였다 — 그래서 #202가 별도
  결함으로 등재됐다. 증상 수리와 구조 수리를 같은 것으로 보고 "완결"이라 보고하지 말 것.
  **배포 워크플로를 늘릴 때는 늘어난 승인 창 개수부터 센다**(재현 명령은 위 "다음 세션이 판정할
  질문" 절 참조).
- **"해소"로 적힌 대장 행도 처방이 여러 개면 부분해소일 수 있다.** #180의 처방은 3개였는데
  2026-09-03 "해소" 표기는 그중 ①(배포 경로 신설)만 이행된 상태를 통째로 적은 것이었다 — ②③은
  그 시점까지 0건이었다(이번 세션이 닫았다). **행을 해소로 옮기기 전에 그 행의 처방 목록을 항목별로
  대조**할 것 — 처방이 하나가 아니면 "해소"가 아니라 "부분해소"로 적어야 한다.
- **일간 보고서를 작성 시점("승인 대기 중")에 멈추면 그 뒤 승인·배포가 끝나도 문서는 그 순간에
  박제된다.** 이번 세션은 작성 당시 "waiting"이던 항목을 승인·배포 완료 확인 후 "후속(같은 날)"
  블록으로 덧붙여 갱신했다(규율 13 — 원문 삭제 0). **같은 날 안에서도 상태가 바뀔 수 있으므로,
  보고서를 "완성"으로 부르기 전에 마지막으로 한 번 더 실행 상태를 재확인**할 것.

## 7-0000. 2026-09-03 세션(QUEUE 1-1 완주·대장 #200)이 남긴 함정

- **두 번째 자동 배포 경로가 생기는 순간 상호 되돌림이 원리적으로 성립한다.** `docker compose up -d
  <service>`는 `--no-deps` 없이는 의존 서비스도 함께 처리한다 — `web`이 `depends_on: api`인데
  `deploy-web.yml`이 `IMAGE_TAG` 없이 `up -d --no-build web`을 돌리자 함께 처리된 api가
  `${IMAGE_TAG:-latest}`(옛 캐시)로 되돌아갔다(대장 #200). **배포 워크플로를 새로 추가할 때마다
  기존 워크플로와의 `depends_on` 교차를 먼저 그려 볼 것** — 이번엔 하필 첫 실배포에서 바로 걸렸다.
- **배포 직후 검증(SHA 대조·스모크)은 그 이후의 되돌림을 원리적으로 못 잡는다.** 15:18의 SHA 대조는
  실제로 참이었고 2분 뒤 다른 프로세스가 덮었다 — "배포 후 1회 판정"과 "지속 감시"는 다른 층이다
  (QUEUE 1단계 각주 참조). 스모크가 초록이라고 "재발 방지 완결"이라 보고하지 말 것.
- **이 리포 환경의 Bash 도구 셸은 zsh다.** `for id in $VAR`(공백 없이 unquoted 다중행 변수)는 zsh
  기본 옵션(`SH_WORD_SPLIT` 꺼짐)에서 **단어분리가 안 돼 루프가 1회만 돈다** — 여러 줄을 통째로 한
  단어로 받아 마지막 반복만 실행된 것처럼 보인다(실측: 48개 ID 루프가 count=1로 나왔다). **여러 줄
  데이터를 순회하려면 `... | while IFS= read -r x; do ... done`를 쓸 것.** bash 스크립트를 그대로
  복붙하면 이 함정을 조용히 밟는다 — 카운트가 작게 나와도 에러가 안 나서 알아채기 어렵다.

## 7-000. 2026-08-30 재판정 세션이 남긴 함정

- **규율 17에는 쌍둥이가 있다 — "너무 좁아 영구 미해소"의 반대편은 "너무 넓어 오해소"다.** #72의 재현 명령이
  `find infra -iname "*.sh" | wc -l ≥ 2`였는데, 모니터링과 무관한 백업 스크립트가 추가되자 임계를 충족했다.
  결함(모니터링 push 스크립트·crontab·Kuma 모니터)은 **하나도 해소되지 않았는데** 명령만 초록이 된다.
  §7의 "`grep -c`는 주석을 센다"와 같은 계열이며, **재현 명령은 결함이 정의된 자리를 직접 재야 한다**
  (여기서는 desired-state SSOT의 `implemented` 플래그 — 구현 방식에 무전제).
- **표 무결성 수리는 숨어 있던 재현 명령을 깨운다.** 파이프 이스케이프를 고치자 그동안 "실행 가능한 명령 없음"으로
  분류돼 **한 번도 실행된 적 없던** #72 명령이 즉시 돌았다. 칸 밀림은 총계만 틀리게 하는 게 아니라 **그 행의 검증
  자체를 침묵시킨다** — 고친 직후 반드시 그 행의 판정을 사람이 다시 본다.
- **"미착수 = 곧 후보"가 아니다.** §4 착수 금지 목록에 없다는 것만으로 후보로 올라온 3건(T-W2-07·T-W3-01·T-W3-02)이
  **선행을 실구동으로 따지니 전부 막혀 있었다**. 후보 표의 비고가 *난이도*만 적고 *선행 충족 여부*를 적지 않으면
  이 착시가 반복된다 — §2-A 표에 **"선행 충족 근거" 칸을 상설**한 이유다.
- **선행 차단이 코드 밖에 있으면 코드로는 영원히 안 열린다.** T-W3-01의 T-NC-08(Apple 조직 계정·D-U-N-S,
  **리드타임 8주**, E1 §A가 대행 불가로 못 박음)이 그 예다. W3 계열을 후보로 세울 때는 **사용자 트랙의 리드타임을
  먼저** 본다. ⚠️ **사실 정정(2026-09-01, 규율 13 — 원문 보존)**: 이 예시의 리드타임 값(8주·D-U-N-S)은
  개인사업자 결정으로 소멸했다(Apple individual 계정은 D-U-N-S 불요, 대신 Google Play 개인 계정 트랙에
  "W3 코드 완료 후 최소 14일"이 새로 생겼다 — 07 §6 "스토어 계정 개설" 블록). **교훈 자체는 불변이다** —
  이 예시가 증명하는 것은 리드타임의 존재가 아니라 *"사용자 본인 인증이 필요한 행위는 대행 불가"*이며 그
  사실은 그대로다.
- **기록치의 stale은 한 방향으로만 가지 않는다.** 이번 실측에서 파일 수는 늘었고(T-W2-05 20→27, T-W2-06 16→20,
  #68 23→48), 교착 실물은 줄었다(1→0). **"문서가 과소 기재한다"는 편향을 갖지 말 것** — 양방향으로 잰다.
- **로컬 맥 세션에서는 `--unshallow`가 불요하다**(`git rev-parse --is-shallow-repository` → false).
  §7-0의 shallow 함정은 **CCR 리모트 한정**이다 — 환경 제약은 문서를 믿지 말고 그 자리에서 재본다.

## 7-00. 2026-08-29~30 세션(실기 검증)이 남긴 함정

- **localhost 잔재는 계열로 온다.** 제온 env에서 DOMAIN·S3_PUBLIC_ENDPOINT가 같은 시기에 localhost로
  들어가 서로 다른 증상(vhost 444 차단 / presigned PUT 즉사)으로 발현했다 — 하나를 찾으면 **같은
  파일의 다른 키를 전수 의심**할 것.
- **가설보다 실값 먼저.** PUT 즉사를 브라우저(로컬 네트워크 정책) 탓으로 추정해 시간을 썼지만 원인은
  `printenv S3_PUBLIC_ENDPOINT` 한 줄이면 나왔다. 브라우저 A/B(Safari↔Chrome 동일 실패)가 가설 기각에
  유효했다 — 두 브라우저가 똑같이 즉사하면 브라우저 정책이 아니다.
- **"세션은 제온에 닿지 않는다"(舊 §0)는 CCR 리모트 한정이다** — 로컬 맥 세션은 SSH 직진단이 됐다.
  환경 제약은 문서를 믿지 말고 착수 시 `nc -z -G 3`으로 재본다(§6 규율 5와 같은 계열).
- **tcpdump 무패킷 판독은 종료-플러시 후에만 확정한다**(리다이렉트 시 블록 버퍼링 — 진행 중 파일이
  비어 보여도 0패킷이 아닐 수 있다). 종료는 `pkill -INT`(통계까지 플러시). 시도 주체는 nginx 로그의
  UA로 교차 확인한다.
- **권한 분류기는 제온 env 쓰기·프로덕션 DB UPDATE를 차단할 수 있다**(이번 2회) — 단문 sed 단독은
  통과했고 복합 스크립트·DB 쓰기가 막혔다. 우회하지 말고 완성형 명령을 사용자에게 넘긴다(§7-1의
  gh pr merge 차단과 같은 계열).
- **GHCR 패키지 가시성은 리포와 별개다** — pull unauthorized면 리포가 PUBLIC인지 먼저 확인하고
  패키지 공개 전환을 검토한다(리포 PUBLIC이면 노출 증분 0). 웹 이미지가 먼저 밟았고(#161 계열)
  백엔드 3종이 이번에 반복했다.

## 7-0. 2026-08-28 세션(T-W2-35·T-W2-02·현행화)이 남긴 함정

- **언급-오검출은 3건이 아니라 6건이었다**(적발 시점 기준 — **그중 T-W2-02는 같은 날 실구현돼
  PR #75로 머지됐으므로 현재 잔여는 5건**이다: T-W1-11b·T-W2-17·T-W4-02·T-W2-05·T-W1-07a).
  신규 3건(T-W2-05·T-W2-02·T-W1-07a)은 각각 딴 태스크의
  feat 커밋 본문이 **부정 맥락으로 언급**한 것에 걸렸다: "reporter·control-center분 global.css는
  T-W2-05·06 소관으로 **남는다**"(3591edd) · "T-W2-02 **미착수**라"(5c6023f) · "소비 트랙은 T-W1-07a
  **잔여**"(41569e9). 산출물 실측으로 확정: reporter `theme.ts` 실존(hex 하드코딩) · reporter 업로더에
  XMLHttpRequest 0건 · watch 화면에 마일스톤 계측·큰 자막 토글 부재. **선별 스윕 방법**: 매치 ID 중
  구현 커밋 **제목**에 ID가 없는 것만 추리면(이번 12건) 검증 대상이 1/3로 준다 — 제목 매치는 전건
  실구현이었고, 오검출 6건 전부가 **본문-단독 매치**였다. 본문-단독이라도 실구현인 경우가 있으므로
  (웨이브 묶음 커밋 6건) 최종 판정은 산출물 실측으로 한다.
- **CCR 리모트 세션의 클론은 shallow다**(이번 실측 154커밋) — 과거 구현 커밋이 로컬에 없어 §5 진행률
  grep이 **조용히 과소 계상**된다(실측 27 → `git fetch --unshallow` 후 34). 같은 계열: 로컬 `main`
  ref가 stale일 수 있다 — diff·기준선은 fetch 후 **`origin/main`**으로 잰다(T-W2-35 qa-verifier가
  실제로 머지 완료된 T-W2-36 파일이 섞인 `git diff main...HEAD`를 밟았다. 실 diff는 머지베이스 기준).
- **이 리포의 @testing-library/react-native에선 `render()`가 await 대상이다** — 안 기다리면 쿼리
  없는 Promise를 쥔다(`detail-screen.test.tsx`가 선례). jest 원샷 실행의 `--forceExit`(§7-1)와 짝.
- **세션 권한 가드(guard.sh)는 명령줄 문자열 속 `.env`도 차단한다** — PR 본문 등 긴 텍스트 인자는
  파일로 빼서 `--body-file`로 우회한다(직전 세션 실측).

## 7-1. 2026-08-26 세션이 남긴 함정

- **§5 진행률 판정은 "언급"과 "구현"을 구분하지 못한다.** 오검출은 1건이 아니라 **3건**이다
  (2026-08-28 재실측): **T-W1-11b·T-W2-17·T-W4-02** 전부 커밋 260d9f0(`fix(ci)` — redis-memory-server
  postinstall)이 "ci.yml은 …소유지만 **그 태스크 도달 전에**"라고 넷을 언급한 것에 걸렸고, 그중
  T-W1-11c만 실구현(33ec29d)이 있다. 산출물 실측: ci.yml에 Lighthouse(T-W1-11b)·Playwright
  잡(T-W2-17) 부재. 따라서 §1의 grep 원값 32 완료에는 이 3건이 포함돼 있다 — **실제 29 완료 ·
  17 미착수(63%)**. 판정 시 걸러낼 것.
- **`gh pr merge`·main 푸시가 세션에 따라 권한 분류기에 차단된다**(비대화형 실측 2026-08-26).
  우회하지 말고 PR을 준비 완료로 두고 사용자에게 머지 명령을 넘긴다. main이 orca worktree에
  체크아웃돼 있으면 `git switch main`도 불가하다.
- **워크플로 성공 이력을 계수로 확인하라** — Deploy Web은 "최근 실패"가 아니라 **도입 이래 성공
  0회**였고(#165), 그 뒤의 번들 예산 게이트는 한 번도 실행된 적이 없었다. red의 나이를 재라.
- **jest가 테스트 종료 후 행에 걸린다**(reporter — open handles 경고). 원샷 실행은 `--forceExit`,
  아니면 타임아웃이 뒤 명령(원복 등)까지 삼킨다 — 뮤테이션 검증 시 실제로 밟은 함정.

## 7. 이 세션(2026-08-23)이 남긴 함정

- **`grep -c`는 주석을 센다.** 대장 재현 명령 3건(#114·#134·#137)이 이것 때문에 "해소됨"으로 오검출됐다.
  재현 명령은 **결함의 본질**(예: 타입 선언 유무)을 재야 한다.
- **재현 명령이 해소 방식을 전제하면 영구 미해소로 남는다**(규율 17 신설). #117은 대장이 제시한
  두 선택지 중 한쪽만 검출하는 명령이라, 다른 쪽으로 고친 뒤에도 계속 0이었다.
- **대장 표에 파이프를 쓸 때는 `\|`로 이스케이프한다.** 안 하면 칸이 밀려 **총계가 조용히 틀린다**.
  이 세션에서 3번 밟았고, 그중 하나는 *"파이프를 쓰지 말라"는 경고 문구 자신*이었다.
  **일괄 치환으로 고치지 말 것** — 이미 이스케이프된 것까지 재이스케이프해 행을 파손했다(git 복원).
- **shared dist가 stale이면 api 유닛이 5건 실패한다**(`isSafeLinkoutUrl is not a function`).
  코드 결함이 아니다 → `pnpm --filter @gachinol/shared build` 선행.
- **`@gachinol/config` 심링크가 없으면 `pnpm lint`가 `ERR_MODULE_NOT_FOUND`로 죽는다**
  → `pnpm install --frozen-lockfile`.
- **머지 확인과 브랜치 삭제를 같은 명령에 넣지 말 것** — 과거 PR이 머지 없이 CLOSED된 사고 패턴이다.

## 8. 사용자 대기 항목

- **정답 전사(ground truth)** — 도구·CER 준비 완료(`~/gachinol-inference/stt-eval/`, 52구간 중 5건 입력됨).
  확보 전에는 STT 설정 튜닝이 대리 지표(글자수·키워드)에 의존한다.
- **T-NC-03 PoC**(실기기 18시행) · **T-NC-20 CF Stream 실계정**(지출) · **도메인 확정**(G9 ①)
- ~~⭐ 제온 마이그레이션 `20260827203549` 적용 승인~~ **✅ 충족·적용 완료(2026-09-02, 대장 #170 참조,
  이력 보존)** — 舊 텍스트는 원문 보존: *"`DROP COLUMN` 2개로 비가역이다: `contents.minor_consent_confirmed_at`·
  `..._by_user_id`. T-W2-36이 의도적으로 버린 데이터이므로 손실은 설계된 것이지만, 프로덕션 파괴적
  변경이라 승인 없이 적용하지 않는다."* 사용자 승인 후 SSH 배포로 적용됨, 복원점 `gachinol-20260902-040924.sql.gz`.
- **T-NC-08 스토어 계정 개설**(Apple Developer 조직 = D-U-N-S 선행 + Google Play Console) — **리드타임 W3 착수 8주 전**.
  이번 재판정에서 **T-W3-01·02·03·04 전부의 실질 차단자**로 확인됐다(§2-B). W3를 열려면 이것부터 시작해야 한다.
  ⚠️ **사실 정정(2026-09-01, 규율 13 — 원문 보존)**: 사용자가 개인사업자로 시작하기로 결정해 위 "D-U-N-S 선행·
  8주 전"은 더 이상 유효하지 않다. Apple은 individual 계정(D-U-N-S 불요, 리드타임 사실상 소멸) — 대신
  Google Play 개인 계정 트랙에 **"W3 코드 완료 후 최소 14일"**(테스터 12명×14일 클로즈드 테스트)이 새
  크리티컬 패스로 생겼다. 상세 근거: 07 §6 "스토어 계정 개설" 블록.
- **#149 방송 시각** — 확정되면 3군데를 함께 갱신해야 한다(01 §C-5 · 04 §A SLO#2 · 구독자 편성표 화면).
  편성표 화면에 시:분이 들어가면 실패하는 테스트가 걸려 있어 누락 시 CI가 잡는다.
- **Actions vars `WEB_EXPO_PUBLIC_SUBSCRIBER_WEB_URL` 교정**(T-W2-35 후속 · 대장 #172) — 실측 결과
  미설정이 아니라 **placeholder 리터럴 오설정**: 공유 URL이 깨진 절대 URL로 나간다. 실값 교체 또는
  삭제(삭제 시 경로 표시 정직 강등이 작동).

