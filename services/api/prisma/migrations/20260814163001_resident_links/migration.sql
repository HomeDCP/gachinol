-- CreateTable
CREATE TABLE "resident_upload_links" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "station_id" TEXT NOT NULL,
    "issued_by_user_id" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "max_uploads" INTEGER NOT NULL DEFAULT 5,
    "used_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resident_upload_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resident_uploads" (
    "id" TEXT NOT NULL,
    "link_id" TEXT NOT NULL,
    "content_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "storage_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" BIGINT,
    "uploader_contact" TEXT,
    "consent_agreed_at" TIMESTAMPTZ(3),
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMPTZ(3),
    "completed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "resident_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "resident_upload_links_token_hash_key" ON "resident_upload_links"("token_hash");

-- CreateIndex
CREATE INDEX "resident_upload_links_station_id_created_at_idx" ON "resident_upload_links"("station_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "resident_upload_links_expires_at_idx" ON "resident_upload_links"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "resident_uploads_content_id_key" ON "resident_uploads"("content_id");

-- CreateIndex
CREATE UNIQUE INDEX "resident_uploads_storage_key_key" ON "resident_uploads"("storage_key");

-- CreateIndex
CREATE INDEX "resident_uploads_link_id_created_at_idx" ON "resident_uploads"("link_id", "created_at");

-- CreateIndex
CREATE INDEX "resident_uploads_status_created_at_idx" ON "resident_uploads"("status", "created_at");

-- AddForeignKey
ALTER TABLE "resident_upload_links" ADD CONSTRAINT "resident_upload_links_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "stations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_upload_links" ADD CONSTRAINT "resident_upload_links_issued_by_user_id_fkey" FOREIGN KEY ("issued_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_uploads" ADD CONSTRAINT "resident_uploads_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "resident_upload_links"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_uploads" ADD CONSTRAINT "resident_uploads_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_uploads" ADD CONSTRAINT "resident_uploads_reviewed_by_user_id_fkey" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
