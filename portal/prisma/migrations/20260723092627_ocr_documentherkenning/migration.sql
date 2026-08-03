-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('JAARREKENING', 'NOTULEN_AVA', 'BEVESTIGING_JAARREKENING', 'AKKOORD_IB', 'AKKOORD_VPB', 'OPDRACHTBEVESTIGING', 'OVERIG');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "firstName" TEXT;

-- AlterTable
ALTER TABLE "Document" ADD COLUMN     "detectedKind" "DocumentKind",
ADD COLUMN     "detectedYear" INTEGER,
ADD COLUMN     "ocrUsed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "titleTemplate" TEXT NOT NULL,
    "bodyTemplate" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedById" TEXT,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessageTemplate_kind_key" ON "MessageTemplate"("kind");
