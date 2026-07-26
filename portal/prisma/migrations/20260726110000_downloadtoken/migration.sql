-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "downloadTokenExpiresAt" TIMESTAMP(3),
ADD COLUMN     "downloadTokenHash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Recipient_downloadTokenHash_key" ON "Recipient"("downloadTokenHash");

