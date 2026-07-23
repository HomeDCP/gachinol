-- CreateTable
CREATE TABLE "weekly_recommendations" (
    "id" TEXT NOT NULL,
    "week_of" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "generation" INTEGER NOT NULL DEFAULT 1,
    "summary" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "generated_by_job_id" TEXT,
    "approved_by_user_id" TEXT,
    "approved_at" TIMESTAMPTZ(3),
    "published_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "weekly_recommendations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "weekly_recommendations_week_of_key" ON "weekly_recommendations"("week_of");

-- CreateIndex
CREATE INDEX "weekly_recommendations_status_week_of_idx" ON "weekly_recommendations"("status", "week_of" DESC);

-- CreateIndex
CREATE INDEX "revision_requests_recommendation_id_created_at_idx" ON "revision_requests"("recommendation_id", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "revision_requests" ADD CONSTRAINT "revision_requests_recommendation_id_fkey" FOREIGN KEY ("recommendation_id") REFERENCES "weekly_recommendations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "weekly_recommendations" ADD CONSTRAINT "weekly_recommendations_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

