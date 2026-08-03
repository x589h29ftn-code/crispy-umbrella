-- Bevindingen uit changeset v1.2.

-- Hoe ver het verzegelen van een document is. Expliciet in plaats van afgeleid uit
-- gevulde sleutels, zodat een retry weet waar hij moet beginnen.
CREATE TYPE "SealStage" AS ENUM ('NONE', 'PRESEAL', 'QUALIFIED', 'SEALED');

-- Tweede herstartpunt: de PDF ná de gekwalificeerde handtekening. Zonder dit punt
-- zet een mislukt organisatiezegel de retry terug naar vóór het waarmerken, wat bij
-- een batch van vijftig stukken vijftig keer opnieuw een pincode kost.
ALTER TABLE "Document" ADD COLUMN     "postQualifiedKey" TEXT,
ADD COLUMN     "postQualifiedSha256" TEXT,
ADD COLUMN     "sealStage" "SealStage" NOT NULL DEFAULT 'NONE';

-- Bestaande documenten op de juiste stand zetten.
UPDATE "Document" SET "sealStage" = 'SEALED' WHERE "sealedKey" IS NOT NULL AND "sealedSha256" IS NOT NULL;
UPDATE "Document" SET "sealStage" = 'PRESEAL' WHERE "sealStage" = 'NONE' AND "preSealKey" IS NOT NULL;

-- De uitkomst van signHash vastleggen vóór injectie, plus de hashes exact zoals ze
-- naar de autorisatie zijn gestuurd (om vóór injectie te kunnen controleren).
ALTER TABLE "CscSigningSession" ADD COLUMN     "signatureValues" JSONB,
ADD COLUMN     "sentHashes" JSONB;
