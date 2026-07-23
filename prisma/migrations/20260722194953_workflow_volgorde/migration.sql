-- CreateEnum
CREATE TYPE "SigningMode" AS ENUM ('PARALLEL', 'SEQUENTIAL');

-- AlterTable
ALTER TABLE "Accountant" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Dossier" ADD COLUMN     "signingMode" "SigningMode" NOT NULL DEFAULT 'PARALLEL';

-- AlterTable
ALTER TABLE "Recipient" ADD COLUMN     "accountantId" TEXT;

-- AddForeignKey
ALTER TABLE "Recipient" ADD CONSTRAINT "Recipient_accountantId_fkey" FOREIGN KEY ("accountantId") REFERENCES "Accountant"("id") ON DELETE SET NULL ON UPDATE CASCADE;
