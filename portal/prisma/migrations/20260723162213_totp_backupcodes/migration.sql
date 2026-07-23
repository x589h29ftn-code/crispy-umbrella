-- AlterTable
ALTER TABLE "Accountant" ADD COLUMN     "totpBackupCodes" TEXT[] DEFAULT ARRAY[]::TEXT[];
