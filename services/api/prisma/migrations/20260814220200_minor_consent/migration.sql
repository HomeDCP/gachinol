-- AlterTable
ALTER TABLE "contents" ADD COLUMN     "has_minor_subject" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "minor_consent_confirmed_at" TIMESTAMPTZ(3),
ADD COLUMN     "minor_consent_confirmed_by_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "contents" ADD CONSTRAINT "contents_minor_consent_confirmed_by_user_id_fkey" FOREIGN KEY ("minor_consent_confirmed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
