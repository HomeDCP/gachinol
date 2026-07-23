-- CreateTable
CREATE TABLE "channel_accounts" (
    "id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "station_id" TEXT,
    "name" TEXT NOT NULL,
    "external_channel_id" TEXT NOT NULL,
    "credential_ref" TEXT NOT NULL,
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'connected',
    "connected_at" TIMESTAMPTZ(3),
    "expires_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "channel_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "source_kind" TEXT NOT NULL,
    "content_id" TEXT,
    "live_session_id" TEXT,
    "channel_account_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "external_post_id" TEXT,
    "external_url" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "requested_by_user_id" TEXT,
    "queued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "retracted_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "channel_accounts_platform_external_channel_id_key" ON "channel_accounts"("platform", "external_channel_id");

-- CreateIndex
CREATE INDEX "channel_accounts_station_id_platform_status_idx" ON "channel_accounts"("station_id", "platform", "status");

-- CreateIndex
CREATE INDEX "publications_content_id_created_at_idx" ON "publications"("content_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "publications_status_idx" ON "publications"("status");

-- 부분 유니크(멱등 하드가드) — (content, channel) 활성/성공 송출은 1건. 중복 distribute·재큐 방어.
-- failed/retracted/canceled는 제외 → shared "재송출은 새 행" 허용. Prisma 부분인덱스 미지원 → 수기 SQL.
CREATE UNIQUE INDEX "publications_content_channel_active_key"
    ON "publications" ("content_id", "channel_account_id")
    WHERE "status" IN ('queued', 'publishing', 'published') AND "content_id" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "channel_accounts" ADD CONSTRAINT "channel_accounts_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publications" ADD CONSTRAINT "publications_channel_account_id_fkey" FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
