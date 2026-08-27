/*
  Warnings:

  - You are about to drop the column `minor_consent_confirmed_at` on the `contents` table. All the data in the column will be lost.
  - You are about to drop the column `minor_consent_confirmed_by_user_id` on the `contents` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "contents" DROP CONSTRAINT "contents_minor_consent_confirmed_by_user_id_fkey";

-- AlterTable
ALTER TABLE "contents" DROP COLUMN "minor_consent_confirmed_at",
DROP COLUMN "minor_consent_confirmed_by_user_id";
