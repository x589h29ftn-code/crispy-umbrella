-- AlterTable
ALTER TABLE "Accountant" ADD COLUMN     "professionalTitle" TEXT,
ADD COLUMN     "nbaNumber" TEXT,
ADD COLUMN     "signingCertProvider" TEXT,
ADD COLUMN     "signingCredentialId" TEXT,
ADD COLUMN     "signingCertEnabled" BOOLEAN NOT NULL DEFAULT false;
