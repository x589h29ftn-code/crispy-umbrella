-- Bevindingen uit changeset v1.3: herinneringen, herverzenden, nudge en
-- auditankers buiten de database.

-- AlterTable
ALTER TABLE "Dossier" ADD COLUMN     "lastWaarmerkNudgeAt" TIMESTAMP(3),
ADD COLUMN     "remindersSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "resendCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "AuditAnchor" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dossierId" TEXT,
    "payload" JSONB NOT NULL,
    "hash" TEXT NOT NULL,
    "deliveries" JSONB NOT NULL,
    "delivered" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditAnchor_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditAnchor_kind_createdAt_idx" ON "AuditAnchor"("kind", "createdAt");

-- CreateIndex
CREATE INDEX "AuditAnchor_dossierId_idx" ON "AuditAnchor"("dossierId");


-- Tellers voor de rate-limiting. Stonden eerder in het geheugen van de
-- webcontainer; dat gaat stuk bij `docker compose up --scale web=2`, want dan
-- gelden de limieten per container. Vorm exact zoals rate-limiter-flexible hem
-- verwacht, zodat de bibliotheek hem niet zelf hoeft aan te maken.
CREATE TABLE IF NOT EXISTS "RateLimit" (
  key varchar(255) PRIMARY KEY,
  points integer NOT NULL DEFAULT 0,
  expire bigint
);
