# 파괴적 마이그레이션 승인 기록

- migration: `20260827203549_drop_minor_consent_confirmation`
- 상태: **사후 기록** — 이 마커 파일은 QUEUE 1-1 / 대장 #180 잔여분 처리(2026-09-05)로
  소급 작성됐다. 마이그레이션 자체는 T-W2-36(동의서 판단 게이트 해체) 처방의 일부로
  **2026-08-27에 이미 적용 완료**됐고(대장 #170), 아래 내용은 그때 실제로 밟은 절차를
  사후에 옮겨 적은 것이지 지금 새로 재현한 것이 아니다.
- 원 출처: `docs/plan/exec/QUEUE.md` C-3행("제온 `DROP COLUMN` 마이그레이션 승인").

## 손실 실측

`contents` 테이블 11행 중 `minor_consent_confirmed_at`·`minor_consent_confirmed_by_user_id`
두 컬럼이 NOT NULL 제약을 가진 행(=DROP 시 비-NULL 값이 유실되는 행) **0건**임을 적용 전에
확인했다. T-W2-36이 의도적으로 버리기로 결정한 데이터라 손실 자체는 설계된 것이었고,
이 실측은 "예상 밖의 값"이 함께 사라지지 않는지를 확인하기 위한 것이었다.

## 복원점

`gachinol-20260902-040924.sql.gz` (제온 백업, 마이그레이션 적용 전 확보)

## 비고

`ALTER TABLE "contents" DROP CONSTRAINT "contents_minor_consent_confirmed_by_user_id_fkey"` +
`DROP COLUMN "minor_consent_confirmed_at"` + `DROP COLUMN "minor_consent_confirmed_by_user_id"`
3개 구문이 대상이다. 적용은 조율자가 SSH로
`docker compose ... pull api ai-worker media-worker && ... up -d --no-build ...`를 실행했을 때
`docker-entrypoint.sh`의 `RUN_MIGRATIONS:-true`가 부팅 전 `prisma migrate deploy`를 자동 실행하며
함께 이뤄졌다(당시엔 이 사전 확인 게이트가 없었다 — 이 태스크가 그 간극을 닫는다).
