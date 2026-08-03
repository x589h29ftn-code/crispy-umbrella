-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('EMAIL', 'SMS');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "verificationMethod" "VerificationMethod" NOT NULL DEFAULT 'EMAIL';

-- AlterTable
ALTER TABLE "Dossier" ADD COLUMN     "sendCopyToRecipient" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "phone" TEXT,
ADD COLUMN     "verificationMethod" "VerificationMethod" NOT NULL DEFAULT 'EMAIL';
