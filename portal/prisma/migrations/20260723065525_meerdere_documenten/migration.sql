/*
  Warnings:

  - You are about to drop the column `documentSha256` on the `Dossier` table. All the data in the column will be lost.
  - You are about to drop the column `fileName` on the `Dossier` table. All the data in the column will be lost.
  - You are about to drop the column `originalKey` on the `Dossier` table. All the data in the column will be lost.
  - You are about to drop the column `sealedKey` on the `Dossier` table. All the data in the column will be lost.
  - You are about to drop the column `workingKey` on the `Dossier` table. All the data in the column will be lost.
  - Added the required column `documentId` to the `SignatureField` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Dossier" DROP COLUMN "documentSha256",
DROP COLUMN "fileName",
DROP COLUMN "originalKey",
DROP COLUMN "sealedKey",
DROP COLUMN "workingKey";

-- AlterTable
ALTER TABLE "SignatureField" ADD COLUMN     "documentId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "dossierId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "originalKey" TEXT,
    "workingKey" TEXT,
    "sealedKey" TEXT,
    "documentSha256" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_dossierId_idx" ON "Document"("dossierId");

-- CreateIndex
CREATE INDEX "SignatureField_documentId_idx" ON "SignatureField"("documentId");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_dossierId_fkey" FOREIGN KEY ("dossierId") REFERENCES "Dossier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SignatureField" ADD CONSTRAINT "SignatureField_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;
