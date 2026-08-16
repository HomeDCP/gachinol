-- 공개 사본 위치 기록(D-T8 / T-W2-33, 대장 #129 ⓐ) — 피드가 항목마다 S3 HEAD를 치던 판정을 DB 기록으로 대체.
-- 전부 nullable·기본값 없음: 기존 행은 NULL로 들어가며 NULL = "공개 사본을 모른다"(보수적) →
-- FeedService가 서명 URL로 폴백하므로 이미 사본이 있는 배포에서도 재생이 깨지지 않는다(CDN 이득만 유예).
-- 백필은 해당 콘텐츠를 다시 발행(publishing→published)하면 syncPublishedCopies가 멱등 재복사하며 채운다.
-- AlterTable
ALTER TABLE "media_assets" ADD COLUMN     "public_bucket" TEXT,
ADD COLUMN     "public_copied_at" TIMESTAMPTZ(3),
ADD COLUMN     "public_key" TEXT;
