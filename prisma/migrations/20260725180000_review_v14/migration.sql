-- AlterTable
ALTER TABLE "Dossier" ADD COLUMN     "archivedAt" TIMESTAMP(3),
ADD COLUMN     "archivedById" TEXT,
ADD COLUMN     "archivedNote" TEXT;

-- AddForeignKey
ALTER TABLE "Dossier" ADD CONSTRAINT "Dossier_archivedById_fkey" FOREIGN KEY ("archivedById") REFERENCES "Accountant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

