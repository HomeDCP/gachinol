-- CreateTable
CREATE TABLE "ai_analyses" (
    "id" TEXT NOT NULL,
    "content_id" TEXT NOT NULL,
    "generation" INTEGER NOT NULL DEFAULT 1,
    "vision" JSONB,
    "text_analysis" JSONB,
    "recommendation_score" DOUBLE PRECISION,
    "model_info" JSONB,
    "created_by_job_id" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMPTZ(3),

    CONSTRAINT "ai_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ai_analyses_content_id_generation_key" ON "ai_analyses"("content_id", "generation");

-- CreateIndex
CREATE INDEX "ai_analyses_content_id_generation_idx" ON "ai_analyses"("content_id", "generation");

-- AddForeignKey
ALTER TABLE "ai_analyses" ADD CONSTRAINT "ai_analyses_content_id_fkey" FOREIGN KEY ("content_id") REFERENCES "contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
