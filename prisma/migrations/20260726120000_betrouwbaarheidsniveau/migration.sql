-- CreateEnum
CREATE TYPE "AssuranceLevel" AS ENUM ('AUDITSPOOR', 'ZEGEL', 'BEROEPS');

-- AlterTable
ALTER TABLE "Dossier" ADD COLUMN     "assuranceLevel" "AssuranceLevel" NOT NULL DEFAULT 'AUDITSPOOR',
ADD COLUMN     "auditReportKey" TEXT,
ADD COLUMN     "auditReportSha256" TEXT;

