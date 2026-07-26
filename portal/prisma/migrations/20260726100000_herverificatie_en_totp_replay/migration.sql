-- AlterTable
ALTER TABLE "Accountant" ADD COLUMN     "lastTotpStep" INTEGER;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "reauthAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "reauthVerifiedAt" TIMESTAMP(3);

