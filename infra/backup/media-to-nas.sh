#!/usr/bin/env bash
# infra/backup/media-to-nas.sh
#
# 대장 #153 — **미디어 원본이 제온 1벌뿐이던 것을 2벌로 만든다.**
#
# 자체 호스팅(제온 MinIO)으로 확정되면서 3-2-1 원칙이 통째로 깨졌다. R2 전제일 때는
# 클라우드 제공자의 내구성에 기대고 있었으나 이제 그 책임이 우리에게 넘어왔고,
# **촬영 원본은 재취득이 불가능하다**(현장·시점 1회성이며 07 §3-15 동의 체계상 재촬영도 간단치 않다).
#
# ⚠️ **이 스크립트는 오프사이트 백업이 아니다.** NAS는 제온과 같은 건물에 있어
#    화재·도난·정전·낙뢰에는 함께 당한다. 막아주는 것은 **디스크·호스트 장애**(가장 흔한 실패)와
#    실수로 인한 삭제뿐이다. 진짜 오프사이트(R2 콜드)는 별건으로 남아 있다 — 사용자 결정 대기.
#    이 한계를 알고도 지금 넣는 이유: 사본 1개와 2개의 차이가 2개와 3개의 차이보다 훨씬 크다.
#
# ── 무엇을 백업하나 ──
#   ① MinIO 데이터 디렉터리(미디어 원본·렌디션·썸네일) — 재취득 불가 자산
#   ② PostgreSQL 논리 덤프(메타데이터) — ①이 있어도 ②가 없으면 어느 파일이 무엇인지 모른다
#
# ── 사용법 ──
#   ./media-to-nas.sh              # 1회 실행(systemd timer가 이 경로를 호출)
#   ./media-to-nas.sh --verify     # 마지막 백업의 복구 가능성만 검사하고 종료
#   ./media-to-nas.sh --dry-run    # 전송 없이 계획만 출력
#
# ── 필요 env (infra/docker의 환경설정 파일에서 로드 — 값은 여기 없다) ──
#   NAS_MOUNT       NAS 공유의 마운트 지점 (기본 /mnt/gachinol-backup)
#   MINIO_DATA_DIR  MinIO 데이터 경로 (기본 /srv/dcpwork/minio)
#   POSTGRES_CONTAINER / POSTGRES_USER / POSTGRES_DB   PG 덤프용
#   BACKUP_RETENTION_DAYS  기본 30 (pg-dump-to-r2.sh와 같은 값 규약)
#
# ★ 자격증명은 이 스크립트가 다루지 않는다. NAS 마운트는 `/etc/fstab` + `credentials` 파일이
#   담당하고(설정은 운영자 몫), 스크립트는 **이미 마운트돼 있는지만 확인**한다.
#   마운트가 없으면 로컬 디스크에 백업을 쌓아 디스크를 채우는 대신 **즉시 실패**한다 —
#   "백업이 도는 줄 알았는데 사실은 안 돌고 있었다"가 이 리포에서 실제로 일어났다(#153 착수 전 확인:
#   pg-dump 스크립트는 있었으나 crontab·timer 어디에도 등록돼 있지 않았다).

set -euo pipefail

NAS_MOUNT="${NAS_MOUNT:-/mnt/gachinol-backup}"
MINIO_DATA_DIR="${MINIO_DATA_DIR:-/srv/dcpwork/minio}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
POSTGRES_CONTAINER="${POSTGRES_CONTAINER:-gachinol-prod-postgres-1}"
POSTGRES_USER="${POSTGRES_USER:-gachinol}"
POSTGRES_DB="${POSTGRES_DB:-gachinol}"

STAMP="$(date +%Y%m%d-%H%M%S)"
DRY_RUN=0
VERIFY_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --verify) VERIFY_ONLY=1 ;;
    *) echo "알 수 없는 인자: $arg" >&2; exit 2 ;;
  esac
done

log()  { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
die()  { printf '[%s] ✗ %s\n' "$(date '+%F %T')" "$*" >&2; exit 1; }

# ── 1. 마운트 확인 — 없으면 즉시 실패(로컬에 쌓지 않는다) ──────────────────
is_mounted() {
  # `mountpoint`는 리눅스 전용이라 없을 수 있다 — 없으면 /proc/mounts로 판정한다.
  # (도구 부재를 "마운트 안 됨"과 같은 메시지로 뭉뚱그리면 원인을 오독하게 된다)
  if command -v mountpoint >/dev/null 2>&1; then
    mountpoint -q "$1"
  elif [[ -r /proc/mounts ]]; then
    awk -v m="$1" '$2 == m { found = 1 } END { exit !found }' /proc/mounts
  else
    die "마운트 여부를 판정할 수단이 없다(mountpoint·/proc/mounts 모두 부재) — 이 스크립트는 리눅스 전용이다"
  fi
}

require_mount() {
  is_mounted "$NAS_MOUNT" \
    || die "NAS가 마운트돼 있지 않다: $NAS_MOUNT (fstab/credentials 설정 필요 — README 참조)"
  # 읽기전용으로 마운트된 공유에 조용히 성공한 척하지 않는다
  local probe="$NAS_MOUNT/.write-probe-$$"
  ( : > "$probe" ) 2>/dev/null || die "NAS가 읽기 전용이거나 쓸 수 없다: $NAS_MOUNT"
  rm -f "$probe"
}

# ── 2. 복구 검증 — "백업은 복구 검증 전까지 백업이 아니다"(08 §B) ──────────
#    전량 복원은 비싸므로 **구조적 검증**을 매 회 돌린다:
#      ⓐ 최신 PG 덤프가 gzip으로 온전히 풀리는가(CRC 포함)
#      ⓑ 그 안에 핵심 테이블 DDL이 있는가(빈 덤프·권한 실패 탐지)
#      ⓒ 미디어 사본의 객체 수가 원본과 같은가
#    전량 복원 리허설은 분기 1회 수동(T-NC-15) — 아래 "복구 절차" 주석 참조.
verify_latest() {
  local latest
  latest="$(ls -1t "$NAS_MOUNT"/pg/*.sql.gz 2>/dev/null | head -1 || true)"
  [[ -n "$latest" ]] || die "검증할 PG 덤프가 없다 ($NAS_MOUNT/pg)"

  gzip -t "$latest" || die "PG 덤프가 손상됐다: $latest"
  local tables
  tables="$(zcat "$latest" | grep -cE '^CREATE TABLE' || true)"
  [[ "$tables" -ge 10 ]] || die "PG 덤프에 테이블이 $tables개뿐이다 — 빈 덤프 의심: $latest"
  log "✓ PG 덤프 검증: $(basename "$latest") (CREATE TABLE ${tables}건)"

  if [[ -d "$MINIO_DATA_DIR" && -d "$NAS_MOUNT/minio" ]]; then
    local src dst
    # ★ `.minio.sys`를 세지 않는다(2026-08-23 첫 운영에서 드러남).
    #   MinIO 내부 메타·임시 항목은 수시로 생기고 사라지는데 `--delete`를 쓰지 않으므로 사본에만
    #   누적된다 — 첫 실행 직후 실측이 원본 18 / 사본 42였다. 전체 파일 수로 대조하면 그 노이즈가
    #   **실제 콘텐츠의 누락을 가려버린다**(같은 시점 콘텐츠 객체는 28/28로 정확히 일치했다).
    #   검증 지표는 우리가 지키려는 것 — **버킷 안의 실제 객체** — 만 센다.
    src="$(find "$MINIO_DATA_DIR" -type f -not -path '*/.minio.sys/*' 2>/dev/null | wc -l)"
    dst="$(find "$NAS_MOUNT/minio" -type f -not -path '*/.minio.sys/*' 2>/dev/null | wc -l)"
    log "미디어 객체 수(.minio.sys 제외): 원본 $src / 사본 $dst"
    if [[ "$dst" -lt "$src" ]]; then
      log "⚠ 사본이 원본보다 적다 — 이번 동기화가 일부 누락됐거나 직후에 새 객체가 생겼다"
    elif [[ "$dst" -gt "$src" ]]; then
      # 정상이다: 원본에서 지워진 객체를 사본은 보존한다(--delete 미사용의 의도된 결과)
      log "  (사본이 $((dst - src))건 많다 — 원본에서 삭제된 객체를 보존 중)"
    fi
  fi
}

if [[ "$VERIFY_ONLY" -eq 1 ]]; then
  require_mount
  verify_latest
  exit 0
fi

# ── 3. 미디어 동기화 ────────────────────────────────────────────────────
#    `--delete`를 쓰지 않는다: 원본에서 지워진 객체를 사본에서도 지우면, 실수·버그로 인한
#    삭제가 그대로 전파돼 백업의 존재 이유가 사라진다. 용량은 542MB 수준이라 여유가 크다
#    (실측 2026-08-22: MinIO 542MB / NAS 여유 2.6TB). 증가가 문제되면 보존 정책을 그때 넣는다.
sync_media() {
  [[ -d "$MINIO_DATA_DIR" ]] || die "MinIO 데이터 경로가 없다: $MINIO_DATA_DIR"
  mkdir -p "$NAS_MOUNT/minio"
  local flags=(-a --info=stats2 --no-perms --no-owner --no-group)
  [[ "$DRY_RUN" -eq 1 ]] && flags+=(--dry-run)
  log "미디어 동기화: $MINIO_DATA_DIR → $NAS_MOUNT/minio"
  # --no-perms/owner/group: CIFS는 유닉스 소유권을 보존하지 못해 매번 "변경됨"으로 잡힌다
  rsync "${flags[@]}" "$MINIO_DATA_DIR/" "$NAS_MOUNT/minio/"
}

# ── 4. PG 논리 덤프 ─────────────────────────────────────────────────────
dump_pg() {
  mkdir -p "$NAS_MOUNT/pg"
  local out="$NAS_MOUNT/pg/gachinol-$STAMP.sql.gz"
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "(dry-run) PG 덤프 → $out"
    return 0
  fi
  log "PG 덤프: $POSTGRES_DB → $(basename "$out")"
  # 파이프 중간 실패를 놓치지 않도록 PIPESTATUS를 본다(set -o pipefail이 있어도 명시)
  docker exec "$POSTGRES_CONTAINER" pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" \
    | gzip -9 > "$out"
  [[ "${PIPESTATUS[0]}" -eq 0 ]] || { rm -f "$out"; die "pg_dump 실패"; }
  [[ -s "$out" ]] || { rm -f "$out"; die "덤프가 비어 있다"; }
}

# ── 5. 보존 정리 — PG 덤프만 대상(미디어는 지우지 않는다, 위 주석) ─────────
prune_pg() {
  [[ "$DRY_RUN" -eq 1 ]] && return 0
  local removed
  removed="$(find "$NAS_MOUNT/pg" -name '*.sql.gz' -mtime "+$BACKUP_RETENTION_DAYS" -print -delete | wc -l)"
  [[ "$removed" -gt 0 ]] && log "보존 정리: ${removed}건 삭제(${BACKUP_RETENTION_DAYS}일 초과)"
  return 0
}

main() {
  require_mount
  sync_media
  dump_pg
  prune_pg
  [[ "$DRY_RUN" -eq 1 ]] || verify_latest
  log "✓ 백업 완료"
}

main

# ══════════════════════════════════════════════════════════════════════════
# 복구 절차 (분기 1회 리허설 대상 — T-NC-15)
#
#   ① PG 복원 — **운영 DB에 직접 복원하지 않는다.** 임시 DB로 받아 눈으로 확인한 뒤 교체한다.
#      docker exec -i gachinol-prod-postgres-1 psql -U gachinol -c 'CREATE DATABASE restore_test;'
#      zcat /mnt/gachinol-backup/pg/gachinol-<STAMP>.sql.gz \
#        | docker exec -i gachinol-prod-postgres-1 psql -U gachinol -d restore_test
#      docker exec gachinol-prod-postgres-1 psql -U gachinol -d restore_test \
#        -c 'SELECT count(*) FROM contents;'
#
#   ② 미디어 복원 — MinIO를 멈춘 뒤 디렉터리째 되돌린다(가동 중 덮어쓰면 무결성이 깨진다).
#      docker compose -f ... stop minio
#      rsync -a /mnt/gachinol-backup/minio/ /srv/dcpwork/minio/
#      docker compose -f ... start minio
#
#   ⚠️ 이 두 절차를 **실제로 실행해 본 적이 없다면 백업이 있다고 말하지 않는다.**
#      리허설 결과는 docs/infrastructure.md에 날짜와 함께 남긴다.
# ══════════════════════════════════════════════════════════════════════════
