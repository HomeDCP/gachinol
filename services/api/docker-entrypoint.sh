#!/bin/sh
# api 컨테이너 엔트리포인트 — 부팅 전 DB 마이그레이션 적용 후 CMD 실행.
# RUN_MIGRATIONS=false 로 끄면(다중 인스턴스·마이그레이션을 별도 잡으로 분리할 때) 앱만 기동한다.
set -e

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "[entrypoint] prisma migrate deploy..."
  node_modules/.bin/prisma migrate deploy
fi

exec "$@"
