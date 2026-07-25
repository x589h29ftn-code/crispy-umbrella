-- Werkpakket 6: gekwalificeerd ondertekenen waarbij de accountant zelf
-- autoriseert (Cleverbase, CSC v1) — de sessie moet de browserredirect overleven.

-- AlterTable: status van het certificaat bij de provider bijhouden.
ALTER TABLE "Accountant" ADD COLUMN     "signingCertDisabledAt" TIMESTAMP(3),
ADD COLUMN     "signingCertStatus" TEXT;

-- Het certificaat is persoonsgebonden: één credential hoort bij precies één
-- accountant. Bestaande dubbele waarden eerst opruimen zou data weggooien, dus
-- we gaan ervan uit dat die er niet zijn (de kolom is net geïntroduceerd).
CREATE UNIQUE INDEX "Accountant_signingCredentialId_key" ON "Accountant"("signingCredentialId");

-- CreateTable
CREATE TABLE "CscSigningSession" (
    "id" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "accountantId" TEXT NOT NULL,
    "credentialId" TEXT NOT NULL,
    "dossierId" TEXT,
    "documentIds" TEXT[],
    "preparedKeys" JSONB NOT NULL,
    "hashes" JSONB NOT NULL,
    "serviceToken" TEXT,
    "status" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CscSigningSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CscSigningSession_state_key" ON "CscSigningSession"("state");

-- CreateIndex
CREATE INDEX "CscSigningSession_state_idx" ON "CscSigningSession"("state");

-- CreateIndex
CREATE INDEX "CscSigningSession_status_expiresAt_idx" ON "CscSigningSession"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "CscSigningSession_accountantId_idx" ON "CscSigningSession"("accountantId");

-- AddForeignKey
ALTER TABLE "CscSigningSession" ADD CONSTRAINT "CscSigningSession_accountantId_fkey" FOREIGN KEY ("accountantId") REFERENCES "Accountant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
