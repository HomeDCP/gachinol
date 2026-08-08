#!/usr/bin/env bash
# infra/backup/pg-dump-to-r2.sh
#
# T-W0-04 (08§E-3 "백업 파이프라인(PG→R2 일일)") — PostgreSQL 일일 덤프를 만들어
# S3 호환 오브젝트 스토리지(프로덕션 = Cloudflare R2, 로컬/제온 로컬 = MinIO)의 "별도
# 버킷"(08§B "PG 일일 덤프 → R2 별도 버킷(보존 30일)")에 업로드한다.
#
# 08§B 원칙: "백업은 복구 검증 전까지 백업이 아니다." 이 스크립트는 덤프+업로드까지만
# 수행한다. 복구 리허설(분기 1회, PG 덤프→복원 실제 실행)은 T-NC-15 소관 — 아래
# "복구 절차" 절이 그 리허설이 따라야 할 명령을 정의한다(이 스크립트는 실행하지 않는다).
#
# R2 vs MinIO: 이 스크립트는 S3_ENDPOINT류 env만 바꾸면 R2·MinIO 양쪽에 그대로
# 동작하도록 작성됐다(CLAUDE.md §5 "코드는 S3_ENDPOINT/S3_FORCE_PATH_STYLE로 R2
# 전환 — env만"). 단, MinIO 도달 성공이 R2 도달을 보장하지 않는다(CORS·멀티파트·
# 서명 방식·에러 코드 구현 차) — 실 R2 검증은 EXEC-DECISIONS #12에 따라 보류 항목.
#
# ── 사용법 ──
#   ./infra/backup/pg-dump-to-r2.sh              # 덤프 1회 실행(crontab이 이 경로로 호출)
#   ./infra/backup/pg-dump-to-r2.sh --restore-help  # 복구 명령 안내만 출력하고 종료
#
# ── 필요 env (전부 .env류에서 로드 — 하드코딩 금지, 값은 여기 없음) ──
#   DB 연결(둘 중 하나만 있으면 됨):
#     ① docker exec 방식(prod/xeon 기본 — DB 포트가 외부에 열려 있지 않은 배치와 정합):
#        POSTGRES_USER, POSTGRES_PASSWORD, POSTGRES_DB
#        POSTGRES_CONTAINER (선택 — 미설정 시 `docker compose` 라벨로 자동 탐색)
#     ② 직접 연결 방식(로컬 dev처럼 DB 포트가 열려 있고 docker/컨테이너가 없을 때 폴백):
#        DATABASE_URL + 로컬 pg_dump 바이너리
#   업로드 목적지(S3 호환 — 값 미설정 시 아래처럼 기존 S3_* 키를 재사용):
#     BACKUP_S3_ENDPOINT   (미설정 시 S3_ENDPOINT)
#     BACKUP_S3_BUCKET     (기본 gachinol-backups — 미디어 버킷 S3_BUCKET과 "별도 버킷" 원칙)
#     BACKUP_S3_ACCESS_KEY (미설정 시 S3_ACCESS_KEY)
#     BACKUP_S3_SECRET_KEY (미설정 시 S3_SECRET_KEY)
#   보존:
#     BACKUP_RETENTION_DAYS (기본 30 — 08§B "보존 30일")
#   실패 알림(선택 — 미설정 시 알림 생략, 로그만 남김):
#     BACKUP_ALERT_WEBHOOK_URL (Slack/Discord 호환 incoming webhook — JSON {"text": "..."} POST)
#   DCP 공존(선택 — 08§B "제온 서버는 DCP 파이프라인과 CPU/RAM 공유"):
#     DCP_ARBITER_URL (설정 시 이 스크립트 실행 컨텍스트(호스트 cron)에서 도달 가능한 값을 넣을 것.
#       DCP api는 호스트 루프백(127.0.0.1:8080)에만 바인드하므로 보통 http://127.0.0.1:8080 —
#       api 서비스의 동명 env(브리지 컨테이너용 host.docker.internal)와 값이 다를 수 있다.
#       busy 여부만 조회해 로그에 남긴다 — DcpArbiterService와 달리 백업을 건너뛰지 않는다.
#       [설계 결정] 데이터 보호가 인코딩 자원 양보보다 우선이므로 이 스크립트는 항상 실행하고,
#       DCP busy가 관측되면 nice/ionice 우선순위를 더 낮춰(경합 완화) 진행한다.)
#   임시 경로: BACKUP_TMP_DIR (기본 mktemp -d)
#     ⚠️ [로컬 macOS + colima 한정 함정 — 배포 대상(Debian 13 제온)에는 해당 없음]
#     macOS에서 colima로 docker를 띄우면 VM에 기본 마운트되는 경로가 $HOME 하위뿐이다
#     (colima.yaml `mounts: []` = 기본값, $HOME만 virtiofs로 공유). BACKUP_TMP_DIR을
#     비워두면 macOS 기본 mktemp가 $TMPDIR(예: /var/folders/...)를 쓰는데, 이 경로는
#     VM에 안 보여서 docker_mc 폴백(3-tier의 마지막 단계, s3_put/s3_prune_old 참조)의
#     바인드 마운트(`-v "$BACKUP_TMP_DIR:/work:ro"`)가 "not found"로 실패한다(2026-08-08
#     실측). 로컬에서 이 폴백 경로를 테스트하려면 BACKUP_TMP_DIR을 $HOME 하위로 지정할
#     것. 제온은 VM 경계 자체가 없는 네이티브 Linux 호스트라 이 함정이 재현되지 않는다
#     — 실 배포 실패로 오인해 원인을 잘못 짚지 않도록 범위를 여기 한정해 남긴다.
#
# ── crontab 시각 선택 근거는 infra/backup/crontab 상단 주석 참조 ──
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# ── 0. --restore-help ──────────────────────────────────────────────────────
print_restore_instructions() {
  cat <<'EOF'
── 복구 절차 (T-NC-15 분기 리허설이 실제 검증하는 절차 — 이 스크립트는 실행하지 않는다) ──

덤프 포맷: pg_dump custom format(-F c, 압축 포함) — pg_restore로만 복원 가능
(psql로 직접 로드 불가. plain SQL이 아님에 유의).

1) 백업 오브젝트 목록 확인:
   mc ls backup/${BACKUP_S3_BUCKET:-gachinol-backups}/pg/${POSTGRES_DB:-gachinol}/
   (또는) aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 ls "s3://${BACKUP_S3_BUCKET:-gachinol-backups}/pg/${POSTGRES_DB:-gachinol}/"

2) 다운로드 + 무결성 확인.
   .sha256 파일에는 다이제스트 "값만" 들어있다(파일명 없음) — 아래처럼 로컬 파일명을
   검증 시점에 직접 조립해 대조하므로, 다운로드본을 어떤 이름으로 저장/개명해도(아래처럼
   restore.dump로 바꿔도) 항상 성립한다(표준 `sha256sum -c <파일>`처럼 내부에 적힌 옛
   파일명을 찾는 방식이 아님 — 개명 시 깨지는 문제가 구조적으로 없다):
   mc cp backup/<bucket>/pg/<db>/<파일>.dump ./restore.dump
   mc cp backup/<bucket>/pg/<db>/<파일>.dump.sha256 ./restore.dump.sha256
   printf '%s  %s\n' "$(cat restore.dump.sha256)" restore.dump | sha256sum -c -
   (sha256sum 없는 macOS 등에서는) printf '%s  %s\n' "$(cat restore.dump.sha256)" restore.dump | shasum -a 256 -c -

3) 리허설은 반드시 "별도 DB/별도 인스턴스"에 먼저 복원한다(운영 DB에 직접 덮어쓰지 않는다):
   createdb -U <user> gachinol_restore_test
   pg_restore -U <user> -h <host> -d gachinol_restore_test --clean --if-exists --no-owner --jobs=4 restore.dump

4) 리허설 성공 기준(T-NC-15가 매 분기 기록): 복원 후 핵심 테이블(row count) 대조 +
   애플리케이션이 그 DB로 기동해 헬스체크(readiness, DB SELECT 1 포함) 통과.
   결과는 reviews/dod-evidence/ops-review.md 1행씩 누적(08§B "복구 리허설을 분기 1회").

5) 실 장애 시에만 운영 DB로 최종 복원:
   pg_restore -U <user> -h <host> -d <운영DB> --clean --if-exists --no-owner --jobs=4 restore.dump
EOF
}

if [[ "${1:-}" == "--restore-help" ]]; then
  print_restore_instructions
  exit 0
fi

# ── 1. 로깅/알림 유틸 ───────────────────────────────────────────────────────
log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() {
  log "ERROR: $*"
  notify_failure "$*"
  exit 1
}

notify_failure() {
  local message="$1"
  if [[ -z "${BACKUP_ALERT_WEBHOOK_URL:-}" ]]; then
    log "알림 미설정(BACKUP_ALERT_WEBHOOK_URL 없음) — 실패를 로그에만 남김"
    return 0
  fi
  # JSON 페이로드에 그대로 넣기 전에 큰따옴표를 치환(안전한 최소 이스케이프).
  local safe_message
  safe_message="$(printf '%s' "$message" | tr '"' "'")"
  # 실패 알림 자체의 실패가 원래 에러를 가리지 않도록 non-fatal(| true)
  curl -fsS -m 10 -X POST -H 'Content-Type: application/json' \
    -d "{\"text\": \"[gachinol backup] PG→R2 덤프 실패: ${safe_message}\"}" \
    "$BACKUP_ALERT_WEBHOOK_URL" >/dev/null 2>&1 \
    || log "WARN: 실패 알림 전송 자체가 실패함(웹훅 URL/네트워크 확인 필요)"
}

cleanup() {
  if [[ -n "${BACKUP_TMP_DIR_IS_TEMP:-}" && -d "${BACKUP_TMP_DIR:-}" ]]; then
    rm -rf "$BACKUP_TMP_DIR"
  fi
}
trap cleanup EXIT

# ── 1-1. 중복 실행 방지 락(D8-6 리소스 리밋 축 — 제온은 DCP와 자원을 공유하므로
#         수동 재실행이 crontab 스케줄과 겹쳐 pg_dump 2개가 동시에 도는 것을 막는다) ──
BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/gachinol-pg-backup.lock}"
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_LOCK_FILE"
  flock -n 9 || die "이미 다른 백업 프로세스가 실행 중(lock=$BACKUP_LOCK_FILE) — 중복 실행 방지로 종료"
else
  log "WARN: flock 미탐지(예: macOS 로컬 테스트) — 중복 실행 방지 비활성. 배포 대상(Debian 13 제온)은 flock 기본 포함."
fi

# ── 2. 설정 로드(기존 S3_* 키 재사용 + BACKUP_* 오버라이드) ─────────────────
BACKUP_S3_ENDPOINT="${BACKUP_S3_ENDPOINT:-${S3_ENDPOINT:-}}"
BACKUP_S3_BUCKET="${BACKUP_S3_BUCKET:-gachinol-backups}"
BACKUP_S3_ACCESS_KEY="${BACKUP_S3_ACCESS_KEY:-${S3_ACCESS_KEY:-}}"
BACKUP_S3_SECRET_KEY="${BACKUP_S3_SECRET_KEY:-${S3_SECRET_KEY:-}}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
POSTGRES_DB="${POSTGRES_DB:-gachinol}"

[[ -n "$BACKUP_S3_ENDPOINT" ]] || die "BACKUP_S3_ENDPOINT(또는 S3_ENDPOINT) 미설정"
[[ -n "$BACKUP_S3_ACCESS_KEY" ]] || die "BACKUP_S3_ACCESS_KEY(또는 S3_ACCESS_KEY) 미설정"
[[ -n "$BACKUP_S3_SECRET_KEY" ]] || die "BACKUP_S3_SECRET_KEY(또는 S3_SECRET_KEY) 미설정"
[[ "$BACKUP_RETENTION_DAYS" =~ ^[0-9]+$ ]] || die "BACKUP_RETENTION_DAYS는 정수여야 함: $BACKUP_RETENTION_DAYS"

if [[ -n "${BACKUP_TMP_DIR:-}" ]]; then
  mkdir -p "$BACKUP_TMP_DIR"
else
  BACKUP_TMP_DIR="$(mktemp -d -t gachinol-pg-backup.XXXXXX)"
  BACKUP_TMP_DIR_IS_TEMP=1
fi

TIMESTAMP="$(date -u +%Y%m%d_%H%M%S)"
DUMP_FILENAME="pg_${POSTGRES_DB}_${TIMESTAMP}.dump"
DUMP_PATH="${BACKUP_TMP_DIR}/${DUMP_FILENAME}"
REMOTE_PREFIX="pg/${POSTGRES_DB}"
REMOTE_KEY="${REMOTE_PREFIX}/${DUMP_FILENAME}"

# ── 3. DCP 아비터 공존(best-effort, 실패해도 백업은 계속) ──────────────────
# 08§B: 제온은 가동 중인 DCP 파이프라인과 CPU/RAM을 공유한다. 이 스크립트는
# DcpArbiterService(api)와 달리 "정지"하지 않는다 — 백업 누락이 인코딩 경합보다
# 나쁜 결과이기 때문. busy 관측 시 nice/ionice로 자원 우선순위만 더 낮춘다.
NICE_LEVEL=15
IONICE_ARGS=(-c2 -n6) # best-effort I/O, 중간 우선순위(기본)
if [[ -n "${DCP_ARBITER_URL:-}" ]]; then
  dcp_state="$(curl -fsS -m 3 "${DCP_ARBITER_URL%/}/api/arbiter/state" 2>/dev/null || true)"
  if [[ -n "$dcp_state" ]]; then
    if printf '%s' "$dcp_state" | grep -q '"busy"[[:space:]]*:[[:space:]]*true'; then
      log "DCP busy 관측됨 — 백업은 계속 진행하되 idle 우선순위로 양보"
      NICE_LEVEL=19
      IONICE_ARGS=(-c3) # idle class
    else
      log "DCP idle 관측됨 — 표준 우선순위로 진행"
    fi
  else
    log "DCP 아비터 상태 조회 실패(무응답) — 조회 없이 표준 우선순위로 진행"
  fi
fi

# 로컬(직접 pg_dump 경로)용 nice/ionice 접두 배열.
NICE_PREFIX=()
command -v nice >/dev/null 2>&1 && NICE_PREFIX+=(nice -n "$NICE_LEVEL")
if command -v ionice >/dev/null 2>&1; then
  NICE_PREFIX+=(ionice "${IONICE_ARGS[@]}")
fi
IONICE_ARGS_STR="${IONICE_ARGS[*]}"

# ── 4. Postgres 컨테이너 탐색(docker exec 방식 우선) ────────────────────────
resolve_postgres_container() {
  if [[ -n "${POSTGRES_CONTAINER:-}" ]]; then
    printf '%s' "$POSTGRES_CONTAINER"
    return 0
  fi
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --filter "label=com.docker.compose.service=postgres" --format '{{.Names}}' 2>/dev/null | head -n1
}

# ── 5. pg_dump 실행 ─────────────────────────────────────────────────────────
dump_database() {
  local container
  container="$(resolve_postgres_container || true)"

  if [[ -n "$container" ]]; then
    log "docker exec 방식으로 덤프: container=$container db=$POSTGRES_DB"
    [[ -n "${POSTGRES_USER:-}" ]] || die "POSTGRES_USER 미설정(docker exec 방식 필수)"
    # nice/ionice는 컨테이너 "내부" 셸에서 조건부 적용한다 — 로컬 docker CLI 프로세스만
    # nice해서는 실제 자원을 쓰는 컨테이너 내부 pg_dump 우선순위가 낮아지지 않는다
    # (postgres:16-alpine 확인됨: busybox nice·ionice 둘 다 포함, 2026-08-08 실측 —
    # 이미지가 달라 없는 경우에도 command -v로 조건부 적용해 안전하게 폴백).
    docker exec \
      -e PGPASSWORD="${POSTGRES_PASSWORD:-}" \
      -e PGUSER="$POSTGRES_USER" \
      -e PGDATABASE="$POSTGRES_DB" \
      -e GACHINOL_NICE_LEVEL="$NICE_LEVEL" \
      -e GACHINOL_IONICE_ARGS="$IONICE_ARGS_STR" \
      "$container" sh -c '
        cmd="pg_dump -F c -Z 6"
        command -v ionice >/dev/null 2>&1 && cmd="ionice ${GACHINOL_IONICE_ARGS} ${cmd}"
        command -v nice >/dev/null 2>&1 && cmd="nice -n ${GACHINOL_NICE_LEVEL} ${cmd}"
        exec ${cmd}
      ' >"$DUMP_PATH" \
      || die "pg_dump(docker exec) 실패"
  elif command -v pg_dump >/dev/null 2>&1 && [[ -n "${DATABASE_URL:-}" ]]; then
    log "로컬 pg_dump 바이너리로 덤프(DATABASE_URL 직접 연결)"
    "${NICE_PREFIX[@]}" pg_dump "$DATABASE_URL" -F c -Z 6 -f "$DUMP_PATH" \
      || die "pg_dump(direct) 실패"
  else
    die "postgres 컨테이너를 찾지 못했고(docker 미탐지 또는 라벨 불일치) 로컬 pg_dump/DATABASE_URL 폴백도 불가 — POSTGRES_CONTAINER 또는 DATABASE_URL+pg_dump 준비 필요"
  fi

  [[ -s "$DUMP_PATH" ]] || die "덤프 파일이 비어있음: $DUMP_PATH"
  log "덤프 완료: $DUMP_PATH ($(du -h "$DUMP_PATH" | cut -f1))"

  # 무결성 체크섬(복구 전 검증용, media-worker sha256File 관례와 동형).
  # [게이트② FAIL 수정] .sha256에는 다이제스트 "값만" 담는다(파일명 한 줄을 담지 않음) —
  # `sha256sum -c`류 표준 포맷은 내부에 적힌 파일명과 로컬 파일명이 일치해야 검증되므로,
  # 복구 시 다운로드본을 다른 이름으로 저장/개명하면(자연스러운 운영 습관) 즉시 깨진다.
  # 다이제스트만 저장하면 검증 명령이 "지금 이 로컬 파일명"을 매번 새로 조립해 대조하므로
  # 어떤 이름으로 저장하든(원본 유지·개명 전부) 항상 성립한다 — 이름 불변 규율에 기대지 않는
  # 구조적 해법. --restore-help의 검증 명령과 반드시 짝을 맞출 것(아래 print_restore_instructions).
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$DUMP_PATH" | awk '{print $1}' >"${DUMP_PATH}.sha256"
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$DUMP_PATH" | awk '{print $1}' >"${DUMP_PATH}.sha256"
  else
    log "WARN: sha256sum/shasum 없음 — 체크섬 생략(무결성 검증 불가 상태로 업로드됨)"
  fi
}

# ── 6. S3 호환 업로드/보존 정리 (mc 네이티브 > aws-cli > 도커화 mc 3단 폴백) ─
# R2·MinIO 모두 S3 호환이라 동일 로직으로 동작(CLAUDE.md §5). 엔드포인트 재작성으로
# MC_HOST_backup 환경변수를 구성해 자격증명을 명령행 문자열에 직접 끼워 넣지 않는다.
build_mc_host_env() {
  local scheme host_and_rest
  scheme="${BACKUP_S3_ENDPOINT%%://*}"
  host_and_rest="${BACKUP_S3_ENDPOINT#*://}"
  printf '%s://%s:%s@%s' "$scheme" "$BACKUP_S3_ACCESS_KEY" "$BACKUP_S3_SECRET_KEY" "$host_and_rest"
}

s3_client_tier() {
  if command -v mc >/dev/null 2>&1; then
    printf 'native_mc'
  elif command -v aws >/dev/null 2>&1; then
    printf 'native_aws'
  elif command -v docker >/dev/null 2>&1; then
    printf 'docker_mc'
  else
    printf 'none'
  fi
}

s3_ensure_bucket() {
  # 버킷이 없으면 최초 1회 생성(minio-init 관례와 동형, --ignore-existing으로 멱등).
  # 08§B "R2 별도 버킷"은 사전 존재를 전제하지만, 실수로 미생성 상태로 방치돼 크론이
  # 매일 조용히 실패하는 함정을 막기 위한 안전망 — 이미 있으면 그대로 통과한다.
  local tier mc_host
  tier="$(s3_client_tier)"
  case "$tier" in
    native_mc)
      mc_host="$(build_mc_host_env)"
      MC_HOST_backup="$mc_host" mc mb --ignore-existing "backup/${BACKUP_S3_BUCKET}"
      ;;
    native_aws)
      AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
        aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 mb "s3://${BACKUP_S3_BUCKET}" \
        --region "${BACKUP_S3_REGION:-${S3_REGION:-auto}}" 2>/dev/null \
        || log "버킷이 이미 존재하거나(정상) 생성 실패 — 계속 진행해 업로드에서 실패 여부 재확인"
      ;;
    docker_mc)
      mc_host="$(build_mc_host_env)"
      docker run --rm --add-host=host.docker.internal:host-gateway \
        -e "MC_HOST_backup=${mc_host}" \
        minio/mc:latest mb --ignore-existing "backup/${BACKUP_S3_BUCKET}"
      ;;
    *)
      die "mc/aws/docker 중 아무것도 없음 — 버킷 확인 불가"
      ;;
  esac
}

s3_put() {
  local local_path="$1" remote_key="$2"
  local tier mc_host
  tier="$(s3_client_tier)"
  case "$tier" in
    native_mc)
      mc_host="$(build_mc_host_env)"
      MC_HOST_backup="$mc_host" mc cp "$local_path" "backup/${BACKUP_S3_BUCKET}/${remote_key}"
      ;;
    native_aws)
      AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
        aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 cp "$local_path" "s3://${BACKUP_S3_BUCKET}/${remote_key}" \
        --region "${BACKUP_S3_REGION:-${S3_REGION:-auto}}"
      ;;
    docker_mc)
      # 로컬 macOS+colima 한정 함정(배포 대상 무관) — 상단 BACKUP_TMP_DIR 주석 참조.
      # 이 바인드 마운트가 VM에 안 보이는 호스트 경로를 가리키면 "not found"로 실패한다.
      mc_host="$(build_mc_host_env)"
      docker run --rm --add-host=host.docker.internal:host-gateway \
        -e "MC_HOST_backup=${mc_host}" \
        -v "${BACKUP_TMP_DIR}:/work:ro" \
        minio/mc:latest cp "/work/$(basename "$local_path")" "backup/${BACKUP_S3_BUCKET}/${remote_key}"
      ;;
    *)
      die "mc/aws/docker 중 아무것도 없음 — 업로드 불가(mc 또는 docker 설치 필요)"
      ;;
  esac
}

s3_list() {
  local prefix="$1"
  local tier mc_host
  tier="$(s3_client_tier)"
  case "$tier" in
    native_mc)
      mc_host="$(build_mc_host_env)"
      MC_HOST_backup="$mc_host" mc ls "backup/${BACKUP_S3_BUCKET}/${prefix}"
      ;;
    native_aws)
      AWS_ACCESS_KEY_ID="$BACKUP_S3_ACCESS_KEY" AWS_SECRET_ACCESS_KEY="$BACKUP_S3_SECRET_KEY" \
        aws --endpoint-url "$BACKUP_S3_ENDPOINT" s3 ls "s3://${BACKUP_S3_BUCKET}/${prefix}" \
        --region "${BACKUP_S3_REGION:-${S3_REGION:-auto}}"
      ;;
    docker_mc)
      mc_host="$(build_mc_host_env)"
      docker run --rm --add-host=host.docker.internal:host-gateway \
        -e "MC_HOST_backup=${mc_host}" \
        minio/mc:latest ls "backup/${BACKUP_S3_BUCKET}/${prefix}"
      ;;
    *)
      die "mc/aws/docker 중 아무것도 없음 — 목록 조회 불가"
      ;;
  esac
}

s3_prune_old() {
  local prefix="$1" days="$2"
  local tier mc_host
  tier="$(s3_client_tier)"
  case "$tier" in
    native_mc)
      mc_host="$(build_mc_host_env)"
      MC_HOST_backup="$mc_host" mc rm --recursive --force --older-than "${days}d" "backup/${BACKUP_S3_BUCKET}/${prefix}" \
        || log "WARN: 보존 정리(prune) 중 일부 실패 — 다음 실행에서 재시도됨(비치명적)"
      ;;
    native_aws)
      log "WARN: aws-cli 경로는 --older-than 등가 기능이 없어 보존 정리를 건너뜀 — mc 설치 권장(또는 버킷 lifecycle 규칙을 R2/MinIO 콘솔에서 직접 설정)"
      ;;
    docker_mc)
      mc_host="$(build_mc_host_env)"
      docker run --rm --add-host=host.docker.internal:host-gateway \
        -e "MC_HOST_backup=${mc_host}" \
        minio/mc:latest rm --recursive --force --older-than "${days}d" "backup/${BACKUP_S3_BUCKET}/${prefix}" \
        || log "WARN: 보존 정리(prune) 중 일부 실패 — 다음 실행에서 재시도됨(비치명적)"
      ;;
    *)
      log "WARN: 보존 정리 클라이언트 없음 — 건너뜀"
      ;;
  esac
}

# ── 7. 메인 흐름 ─────────────────────────────────────────────────────────────
main() {
  log "=== PG→R2/MinIO 백업 시작: db=$POSTGRES_DB bucket=$BACKUP_S3_BUCKET endpoint=$BACKUP_S3_ENDPOINT ==="

  dump_database

  log "버킷 확인/생성(멱등): ${BACKUP_S3_BUCKET}"
  s3_ensure_bucket || die "백업 버킷 확인/생성 실패"

  log "업로드: $DUMP_PATH -> ${BACKUP_S3_BUCKET}/${REMOTE_KEY}"
  s3_put "$DUMP_PATH" "$REMOTE_KEY" || die "덤프 업로드 실패"
  if [[ -f "${DUMP_PATH}.sha256" ]]; then
    s3_put "${DUMP_PATH}.sha256" "${REMOTE_KEY}.sha256" || log "WARN: 체크섬 업로드 실패(덤프 본체는 업로드 성공)"
  fi

  log "보존 정리: ${BACKUP_RETENTION_DAYS}일 초과 객체 제거 시도(prefix=${REMOTE_PREFIX}/)"
  s3_prune_old "${REMOTE_PREFIX}/" "$BACKUP_RETENTION_DAYS"

  log "업로드 결과 확인:"
  s3_list "${REMOTE_PREFIX}/" || log "WARN: 업로드 후 목록 조회 실패(업로드 자체는 성공으로 기록됨)"

  log "=== 백업 완료: ${DUMP_FILENAME} ==="
  log "복구 절차: $SCRIPT_DIR/pg-dump-to-r2.sh --restore-help (또는 이 파일 상단 주석 참조)"
}

main "$@"
