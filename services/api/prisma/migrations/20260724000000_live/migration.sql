-- CreateTable
CREATE TABLE "live_sessions" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "host_station_id" TEXT NOT NULL,
    "announcer_user_id" TEXT,
    "scheduled_at" TIMESTAMPTZ(3),
    "started_at" TIMESTAMPTZ(3),
    "ended_at" TIMESTAMPTZ(3),
    "rtmp_ingest_url" TEXT,
    "stream_key_ref" TEXT,
    "hls_playback_url" TEXT,
    "target_channel_account_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "weekly_recommendation_id" TEXT,
    "product_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "vod_content_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "live_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "live_comments" (
    "id" TEXT NOT NULL,
    "live_session_id" TEXT NOT NULL,
    "channel_account_id" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "external_comment_id" TEXT NOT NULL,
    "author_name" TEXT NOT NULL,
    "author_external_id" TEXT,
    "author_avatar_url" TEXT,
    "message" TEXT NOT NULL,
    "is_question" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'collected',
    "posted_at" TIMESTAMPTZ(3) NOT NULL,
    "collected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "prompted_at" TIMESTAMPTZ(3),

    CONSTRAINT "live_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages" (
    "id" TEXT NOT NULL,
    "live_session_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_name" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "visibility" TEXT NOT NULL DEFAULT 'visible',
    "moderated_by_user_id" TEXT,
    "sent_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_sessions_status_scheduled_at_idx" ON "live_sessions"("status", "scheduled_at");

-- CreateIndex
CREATE INDEX "live_sessions_host_station_id_created_at_idx" ON "live_sessions"("host_station_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "live_comments_channel_account_id_external_comment_id_key" ON "live_comments"("channel_account_id", "external_comment_id");

-- CreateIndex
CREATE INDEX "live_comments_live_session_id_posted_at_idx" ON "live_comments"("live_session_id", "posted_at");

-- CreateIndex
CREATE INDEX "chat_messages_live_session_id_sent_at_idx" ON "chat_messages"("live_session_id", "sent_at" DESC);

-- AddForeignKey
ALTER TABLE "live_sessions" ADD CONSTRAINT "live_sessions_host_station_id_fkey" FOREIGN KEY ("host_station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "live_comments" ADD CONSTRAINT "live_comments_channel_account_id_fkey" FOREIGN KEY ("channel_account_id") REFERENCES "channel_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_messages" ADD CONSTRAINT "chat_messages_live_session_id_fkey" FOREIGN KEY ("live_session_id") REFERENCES "live_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
