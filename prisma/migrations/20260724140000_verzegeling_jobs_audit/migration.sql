-- Werkpakket 1/2/5/8: cryptografische verzegeling, job queue en scherper auditspoor.

-- AlterEnum: dossier wacht op verzegeling (fail-closed).
ALTER TYPE "DossierStatus" ADD VALUE 'SEALING_FAILED';

-- AlterTable: hashes en zegelgegevens per document.
ALTER TABLE "Document" ADD COLUMN     "preSealKey" TEXT,
ADD COLUMN     "preSealSha256" TEXT,
ADD COLUMN     "sealedSha256" TEXT,
ADD COLUMN     "sealedAt" TIMESTAMP(3),
ADD COLUMN     "timestampedAt" TIMESTAMP(3),
ADD COLUMN     "sealCertSerial" TEXT,
ADD COLUMN     "sealTsaUrl" TEXT;

-- AlterTable: bewaartermijn.
ALTER TABLE "Dossier" ADD COLUMN     "retentionUntil" TIMESTAMP(3);

-- AlterTable: instemmingstekst, getoonde hashes en voorbereiding toegangscode.
ALTER TABLE "Recipient" ADD COLUMN     "consentTextSnapshot" TEXT,
ADD COLUMN     "consentTextHash" TEXT,
ADD COLUMN     "consentShownAt" TIMESTAMP(3),
ADD COLUMN     "presentedHashes" JSONB,
ADD COLUMN     "presentedAt" TIMESTAMP(3),
ADD COLUMN     "accessCodeHash" TEXT,
ADD COLUMN     "accessCodeSetAt" TIMESTAMP(3),
ADD COLUMN     "accessCodeVerifiedAt" TIMESTAMP(3);

-- AlterTable: voorbereiding toegangscode op klantniveau.
ALTER TABLE "Client" ADD COLUMN     "accessCodeHash" TEXT,
ADD COLUMN     "accessCodeSetAt" TIMESTAMP(3);

-- AlterTable: hashketen op het auditspoor.
ALTER TABLE "AuditEvent" ADD COLUMN     "prevHash" TEXT,
ADD COLUMN     "hash" TEXT;

-- CreateIndex
CREATE INDEX "AuditEvent_createdAt_idx" ON "AuditEvent"("createdAt");

-- CreateTable: durable job queue.
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 10,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Job_kind_runAt_completedAt_idx" ON "Job"("kind", "runAt", "completedAt");

-- CreateIndex
CREATE INDEX "Job_lockedAt_idx" ON "Job"("lockedAt");

-- Append-only in techniek, niet alleen op afspraak: een trigger blokkeert UPDATE
-- en DELETE op het auditspoor. Werkt ongeacht met welke databaserol de app
-- verbindt (in tegenstelling tot REVOKE, dat de eigenaar/superuser niet raakt).
-- Voor een geplande opschoning van verlopen dossiers zet je de sessievariabele
-- app.audit_purge tijdelijk op 'on'.
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.audit_purge', true) = 'on' THEN
    -- Let op: een BEFORE UPDATE-trigger die OLD teruggeeft laat de wijziging
    -- stilzwijgend vallen. Daarom expliciet NEW bij UPDATE en OLD bij DELETE.
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'AuditEvent is append-only: % is niet toegestaan', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_no_update
  BEFORE UPDATE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();

CREATE TRIGGER audit_event_no_delete
  BEFORE DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
