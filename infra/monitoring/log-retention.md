# infra/monitoring/log-retention.md — 사고 시 증거 보전 절차

> **T-W0-06** (08§E-3-2 "① 비정상 접근·권한 변경 알림 ② 사고 시 증거 보전(로그 삭제·덮어쓰기 금지) 2항목을
> 기존 Uptime Kuma·`/health/*` 모니터링에 추가 구축", 08§B "보안사고 대응(신규 필수, 07§5-7 액션 2 수신)").
> 07§5-7이 요구한 것은 이 2항목뿐이며 **사고 대응 절차 자체(격리·통지·신고)는 07§5-7 소관**이다 — 이
> 문서는 그 전제 조건인 "증거가 훼손되지 않고 남아 있는 상태"만 구현한다(08 원문: "구현만 담당").
>
> 이 문서는 ②(증거 보전)의 단일 원천이다. ①(비정상 접근·권한 변경 알림)의 탐지 규칙은
> [`uptime-kuma-alerts.json`](./uptime-kuma-alerts.json)이 소유하며, 이 문서는 그 알림이 근거로 삼는
> 로그 원천을 어떻게 삭제·덮어쓰기 없이 보존하는지, ③(디스크·RAM 경보)은 `uptime-kuma-alerts.json`의
> `resource-disk-usage`·`resource-ram-available` 규칙이 전담한다(이 문서에서 재정의하지 않는다).

## 0. 이 문서의 성격 (정직성 고지, uptime-kuma-config.yml과 동형)

아래 절차는 **제온(Debian 13) 배포 대상을 전제로 쓴 실행 가능한 명령**이다. 이 태스크의 소유 파일은
`uptime-kuma-alerts.json`·`log-retention.md` 2개뿐이라 실행 스크립트(`.sh`)·crontab 파일·
`infra/docker/**`(compose·nginx) 변경은 이 문서의 범위 밖이며, `infra/backup/pg-dump-to-r2.sh`·
`infra/backup/crontab`(T-W0-04)과 동일한 성격의 후속 산출물로 남긴다. 이 문서는 그 후속 스크립트가
**정확히 어떤 명령을 실행해야 하는지**를 문자 그대로 규정하는 SSOT이며, 완료 보고에는 이 문서에 적힌
명령을 로컬에서 실제로 실행한 로그가 동봉된다(EXEC-DECISIONS #15 조치 3).

## 1. 원칙 (08§B 원문)

> "사고 시 증거 보전(로그 삭제·덮어쓰기 금지)"

이 한 문장에서 지켜야 할 것은 두 가지다.

1. **삭제 금지** — 보존 기간 내에는 어떤 자동화(우리 자신의 백업 스크립트 포함)도 능동적으로 지우지 않는다.
   `infra/backup/pg-dump-to-r2.sh`의 `s3_prune_old`(백업은 30일 지나면 우리 스크립트가 스스로 지운다)와
   **의도적으로 반대**로 설계한다 — 증거 로그는 보존기간이 지나도 **수동/관리자 검토**를 거쳐야만 지워진다.
2. **덮어쓰기 금지** — Docker의 기본 `json-file` 로그 드라이버는 컨테이너별 로그를 회전(rotate)하며,
   회전 정책(`max-size`/`max-file`)이 없으면 무한정 커지고, 있으면 오래된 로그가 **자동으로 삭제**된다.
   컨테이너 stdout만 신뢰하면 사고가 로그 보존 기간보다 늦게 발견됐을 때 증거가 이미 없다 — 그래서
   ①의 탐지 대상이 되는 로그는 **컨테이너 밖 영속 저장소로 주기적으로 내보내고(export) 그 사본을
   불변(immutable)으로 만든다.**

## 2. 보존 대상 로그 인벤토리 (실제로 존재하는 원천만 — 가상의 로그를 지어내지 않는다)

| 로그 원천 | 현재 위치(실측) | 이 문서에서의 취급 |
|---|---|---|
| nginx(web 컨테이너) access/error log | `infra/docker/nginx.conf`의 `log_format main` → `access_log /dev/stdout main` → 컨테이너 stdout → `docker logs` | §3 절차로 일 단위 export + 체크섬 + 오프사이트 보존. `uptime-kuma-alerts.json`의 `security-app-auth-endpoint-spike`가 실시간 grep 대상으로도 이 로그를 쓴다(동일 원천, 용도만 다름) |
| api(NestJS) 애플리케이션 로그 | `services/api/src/main.ts`가 Nest `Logger`(콘솔) 사용 → 컨테이너 stdout | 위와 동일 — `docker logs gachinol-api-1`(또는 배포 컨테이너명) 대상으로 §3 절차 적용 |
| Postgres 로그 | postgres 컨테이너 stdout(기본 도커 이미지 설정) | 위와 동일 |
| sshd 인증 로그(호스트) | Debian 13 systemd-journald(`journalctl -u ssh`), 시스템 미사용 시 `/var/log/auth.log` | §3 절차 — 호스트 로그는 컨테이너가 아니므로 `journalctl`/`logrotate` 경로로 별도 처리(§3-B) |
| 호스트 계정·권한 파일 스냅샷 | `/etc/passwd`·`/etc/group`·`/etc/sudoers*` 체크섬(생성물, `uptime-kuma-alerts.json`의 `security-host-privilege-integrity`가 매 실행 시 만드는 상태 파일) | 변경 감지 시점의 스냅샷 자체가 증거 — §3-B에 포함해 보존 |
| `refresh_tokens` 테이블(재사용 탐지 이력) | `services/api/prisma/schema.prisma` — `revokedAt`·`replacedById`·`familyId`. 애플리케이션 코드 변경 없이 기존 스키마를 읽기 전용으로 조회만 | 이미 Postgres 데이터이므로 **기존 T-W0-04 `pg-dump-to-r2.sh` 일일 덤프(보존 30일)가 사실상의 백업**이다. 다만 그 백업은 "복구용"이지 "사고 조사용 장기 증거"가 아니다(30일 후 우리 스크립트가 능동 삭제 — §1의 삭제 금지 원칙과 상충) → §4에서 이 간극을 명시적으로 다룬다 |
| `status_transition_logs`(콘텐츠·라이브·추천 등 도메인 엔티티 상태 전이 감사) | `services/api/prisma/schema.prisma` model `StatusTransitionLog` | 위와 동일(§4) |
| `users.role`·`updated_at` | `services/api/prisma/schema.prisma` model `User` | `uptime-kuma-alerts.json`의 `security-user-role-change`가 폴링하는 원천. 전용 감사 테이블은 없음(§4에서 한계로 명시) |

**정직한 한계**: `services/**` 수정이 이 태스크 범위 밖이라 애플리케이션에 요청 단위 접근 로그
미들웨어(예: `express-request-id` + 구조화 로거)나 사용자 권한 변경 전용 감사 테이블은 아직 없다.
이 문서와 `uptime-kuma-alerts.json`은 **현재 실제로 존재하는 로그·테이블만으로** ①②③을 구현하며,
근본적으로 더 나은 방법(전용 audit 테이블 등)은 §6 "후속 권고"로 남긴다 — 없는 로그를 있다고 적지 않는다.

## 3. 보존 파이프라인 (삭제·덮어쓰기 금지의 구현)

### 3-A. 컨테이너 로그 (web·api·postgres — 매일 1회, 자정 직후 권장)

```bash
# EVIDENCE_ROOT: 컨테이너 바깥, 호스트 영속 경로(볼륨 아님 — 로컬 파일시스템)
EVIDENCE_ROOT="${EVIDENCE_ROOT:-/var/log/gachinol/evidence}"
DAY="$(date -u +%F)"
DEST="${EVIDENCE_ROOT}/${DAY}"
mkdir -p "$DEST"

for c in gachinol-web-1 gachinol-api-1 gachinol-postgres-1; do
  docker logs --since 24h "$c" > "${DEST}/${c}.log" 2>&1 || true
  # 체크섬 — 이후 이 사본이 훼손되지 않았음을 검증하는 유일한 수단(백업 sha256 관례와 동형,
  # infra/backup/pg-dump-to-r2.sh와 동일하게 "다이제스트 값만" 저장 — 개명해도 검증식이 안 깨짐)
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "${DEST}/${c}.log" | awk '{print $1}' > "${DEST}/${c}.log.sha256"
  else
    shasum -a 256 "${DEST}/${c}.log" | awk '{print $1}' > "${DEST}/${c}.log.sha256"
  fi
  # 덮어쓰기 방지: 소유자만 읽기, 쓰기 금지(구조적 강제는 3-C의 chattr +i가 최종 방어선)
  chmod 440 "${DEST}/${c}.log" "${DEST}/${c}.log.sha256"
done
```

### 3-B. 호스트 로그 + 권한 파일 스냅샷 (sshd 인증 로그·`/etc/passwd` 등)

```bash
DEST="${EVIDENCE_ROOT:-/var/log/gachinol/evidence}/$(date -u +%F)"
mkdir -p "$DEST"

journalctl -u ssh --since '24 hours ago' > "${DEST}/sshd-auth.log" 2>/dev/null \
  || cp /var/log/auth.log "${DEST}/sshd-auth.log" 2>/dev/null || true

sha256sum /etc/passwd /etc/group /etc/sudoers /etc/sudoers.d/* 2>/dev/null \
  > "${DEST}/host-privilege-snapshot.sha256sums"

sha256sum "${DEST}/sshd-auth.log" | awk '{print $1}' > "${DEST}/sshd-auth.log.sha256"
chmod 440 "${DEST}"/*.log "${DEST}"/*.sha256* 2>/dev/null || true
```

> ⚠️ **셸 이식성 — 위 `sha256sum` 줄은 반드시 `bash`(또는 `sh`/`dash`)로 실행한다.**
> `/etc/sudoers.d/*`가 **빈 디렉터리일 때 zsh는 `no matches found`로 명령 전체를 실행 전에 중단**시켜
> `host-privilege-snapshot.sha256sums`가 **부분 출력조차 없이 아예 생성되지 않는다**(`2>/dev/null`은
> 글롭 실패를 못 막는다 — 리다이렉션이 아니라 셸 파싱 단계에서 죽기 때문). bash는 매치가 없으면 패턴을
> 리터럴로 넘겨 `/etc/passwd`·`/etc/group` 등 나머지가 정상 해싱된다(exit 1이지만 파일 내용은 남는다).
> 배포 대상(Debian 13, cron = `/bin/sh`)에서는 재현되지 않지만 **운영자가 대화형 zsh에서 손으로 실행하면
> 조용히 빈손이 된다** — 증거 보전 절차에서 이 실패 방식은 특히 위험하다.
> zsh에서 부득이 실행해야 하면 그 줄 앞에 `setopt NULL_GLOB`을 두거나 `bash -c '<위 줄>'`로 감싼다.
> (2026-08-08 Wave 4 T-W0-06 게이트②가 이 문서의 절차를 문자 그대로 재실행하다 실측 발견 —
> EXEC-DECISIONS #15 조치 3이 요구한 "산출한 절차를 그대로 실행한 로그"가 잡아낸 사례다. 조율자 반영.)

### 3-C. 불변성(WORM) 강화 — 파일시스템 레벨 (선택, 배포 대상이 ext4일 때만 유효)

```bash
# 권한(440)은 "실수로 덮어쓰기"는 막지만 root/소유자의 "의도적 삭제"는 못 막는다.
# chattr +i(immutable)는 root조차 CAP_LINUX_IMMUTABLE 없이는 지우거나 고치지 못하게 만든다
# (ext4/xfs 전용 — overlay2 위의 컨테이너 내부 파일에는 적용 불가. 호스트 EVIDENCE_ROOT가
# 반드시 컨테이너 바깥의 일반 마운트여야 하는 이유이기도 하다).
for f in "$DEST"/*.log "$DEST"/*.sha256*; do
  chattr +i "$f" 2>/dev/null || true   # 미지원 환경(macOS·비-ext4)에서는 조용히 무시
done
```

### 3-D. 오프사이트 보존 (R2) — "우리 스크립트는 절대 지우지 않는다"

```bash
# 기존 백업 자격증명 재사용(BACKUP_S3_*), 버킷만 분리 — PG 백업(30일, 우리 스크립트가 스스로 prune)과
# 증거 로그(보존기간이 훨씬 길고, prune을 우리 스크립트가 하지 않음)는 삭제 정책이 근본적으로 다르므로
# 같은 버킷을 쓰지 않는다(별도 버킷 원칙은 08§B "PG 일일 덤프 → R2 **별도 버킷**"과 동일 사고를 재사용).
mc mb --ignore-existing "backup/${SECURITY_LOG_S3_BUCKET:-gachinol-security-logs}"
mc cp --recursive "$DEST" \
  "backup/${SECURITY_LOG_S3_BUCKET:-gachinol-security-logs}/$(date -u +%F)/"

# ⚠️ 의도적으로 s3_prune_old에 대응하는 함수가 없다. 삭제는:
#   ① R2 버킷에 Object Lock(Compliance 또는 Governance 모드)을 콘솔에서 SECURITY_LOG_RETENTION_DAYS일
#      보존으로 설정해 두면(권장) 우리 자격증명으로도 그 기간 내 삭제·덮어쓰기가 API 레벨에서 거부된다.
#   ② Object Lock 미설정 환경이라면 보존기간 만료 후에도 "사람이 검토 후 수동 삭제"만 허용한다.
```

## 4. `pg-dump-to-r2.sh`(T-W0-04) 백업과의 관계 — 간극을 정직하게 남긴다

`refresh_tokens`·`status_transition_logs`·`users` 등 Postgres 안의 증거는 이미 T-W0-04의 일일 덤프로
**매일 통째로 백업된다**. 그러나 그 백업은:

- **목적이 다르다** — 복구용(재해 시 서비스 재기동)이지, 사고 조사용 장기 보존이 아니다.
- **보존기간이 다르다** — `BACKUP_RETENTION_DAYS`(기본 30일) 경과분은 `pg-dump-to-r2.sh`의
  `s3_prune_old`가 **스스로 지운다**. §1 "삭제 금지" 원칙과 정면으로 상충한다.

**따라서 사고 조사에 쓸 수 있는 DB 증거는 PG 백업 보존기간(30일) 안에 국한된다** — 이는 이 태스크가
해결하지 않고 남기는 한계다. 완화책(즉시 적용 가능, 코드 변경 없음): 사고 인지 즉시 그 시점의 최신
PG 백업 오브젝트를 `SECURITY_LOG_S3_BUCKET`(§3-D)로 **수동 복사**해 `BACKUP_RETENTION_DAYS`의 자동
삭제 대상에서 격리한다(운영 절차, `pg-dump-to-r2.sh --restore-help`의 다운로드 명령을 그대로 쓰고
`mc cp` 목적지만 증거 버킷으로 바꾸면 된다). 근본 해법(DB 자체의 WAL 아카이빙 기반 PITR 등)은 §6으로
넘긴다.

## 5. 보존 기간 · 검증 방법

| 항목 | 값 | 근거 |
|---|---|---|
| 로컬 사본 보존 | `SECURITY_LOG_RETENTION_DAYS`(기본 **180일**) — 로컬 디스크 공간이 부족해지면 §3-D 업로드 확인 후에만 로컬 사본 정리(자동 삭제 스크립트는 이 문서 범위에서 만들지 않는다 — §1 원칙) | 08§B가 구체 일수를 지정하지 않아 자체 판단: PG 백업(30일)보다 길게 잡아야 "백업 만료 후에도 사고 조사가 가능"하다는 §4 완화 효과가 성립한다. 6개월은 분기 1회 복구 리허설(T-NC-15, 08§B) 주기의 2배로, 최소 한 번의 정기 점검 주기를 넘겨도 증거가 남도록 여유를 둔 값 |
| 오프사이트(R2) 보존 | 로컬과 동일 `SECURITY_LOG_RETENTION_DAYS`, 가능하면 Object Lock으로 삭제 자체를 차단 | §3-D |
| 무결성 검증 | `sha256sum -c`(또는 `shasum -a 256 -c`)로 `.sha256` 사이드카 대조 — `pg-dump-to-r2.sh` 관례와 동일 포맷(다이제스트 값만 저장, 파일명 비의존) | §3-A/§3-B 절차 자체가 검증 가능한 형태로 산출물을 만든다 |
| 검증 주기 | 분기 1회, T-NC-15(복구 리허설)와 같은 세션에서 증거 아카이브 무결성도 함께 확인(신규 태스크 만들지 않고 기존 리허설에 편승 — 08§B "복구 리허설을 분기 1회"의 자연 확장) | §1 "백업은 복구 검증 전까지 백업이 아니다"와 동일 논리를 증거 보전에도 적용 |

## 6. 후속 권고 (이 태스크 범위 밖 — services/** 변경 필요)

- `users.role` 변경 전용 감사 테이블(예: `user_audit_logs` — actor·target·field·old/new·at) 도입.
  현재는 `uptime-kuma-alerts.json`의 `security-user-role-change`가 `updatedAt` 폴링 diff로 대체한다.
- api에 구조화 요청 로거(요청 ID·사용자 ID·IP·경로·상태코드) 도입 — 현재는 nginx 리버스 프록시 로그가
  경로·상태코드만 담고 사용자 ID는 담지 않는다(JWT 페이로드는 로그에 남기지 않는 것이 원칙이므로 이는
  의도적 공백이지만, 사고 조사 시 "어떤 사용자가"를 알기 어렵다는 한계는 남는다).
- R2 Object Lock 실제 설정(콘솔 작업, 코드 아님) — 이 문서는 권고만 하고 실제 버킷 설정은 하지 않는다
  (도메인·제온 노출 방식과 같은 성격의 "사용자/운영자 결정 후 실행" 항목).

## 7. 환경변수 (값은 `.env`에만 — 이 문서·리포에 시크릿 없음)

| 키 | 용도 | 기본값(미설정 시) |
|---|---|---|
| `SECURITY_LOG_S3_BUCKET` | §3-D 오프사이트 보존 버킷명 | `gachinol-security-logs` |
| `SECURITY_LOG_RETENTION_DAYS` | §5 보존 기간(일) | `180` |
| `BACKUP_S3_ENDPOINT`/`BACKUP_S3_ACCESS_KEY`/`BACKUP_S3_SECRET_KEY` | §3-D 업로드 자격증명 — 기존 T-W0-04 키 재사용, 신규 아님 | — |
| `SSH_AUTH_FAILURE_THRESHOLD`·`AUTH_ENDPOINT_401_THRESHOLD`·`DISK_ALERT_*`·`RAM_ALERT_*` | ①③ 임계값 — `uptime-kuma-alerts.json` 소유, 여기서는 재정의하지 않음(참조만) | `uptime-kuma-alerts.json` 각 규칙의 `default` 참조 |
