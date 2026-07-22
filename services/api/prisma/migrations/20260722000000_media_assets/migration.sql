-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "owner_kind" TEXT NOT NULL,
    "content_id" TEXT,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "bucket" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "duration_sec" INTEGER,
    "width" INTEGER,
    "height" INTEGER,
    "bitrate_kbps" INTEGER,
    "video_codec" TEXT,
    "audio_codec" TEXT,
    "rendition_label" TEXT,
    "checksum_sha256" TEXT,
    "created_by_job_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_bucket_storage_key_key" ON "media_assets"("bucket", "storage_key");

-- CreateIndex
CREATE INDEX "media_assets_content_id_kind_generation_idx" ON "media_assets"("content_id", "kind", "generation");

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
