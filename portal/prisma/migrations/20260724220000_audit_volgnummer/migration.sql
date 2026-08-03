-- Doorlopend volgnummer op het auditspoor.
--
-- De hashketen detecteert het wijzigen of verwijderen van een regel midden in de
-- reeks (de volgende regel sluit dan niet meer aan), maar niet het verwijderen
-- van de oudste regels: er is dan geen volgende regel die iets mist. Een gat in
-- de nummering maakt dat wel zichtbaar.
ALTER TABLE "AuditEvent" ADD COLUMN "seq" BIGSERIAL NOT NULL;

-- Uniek en oplopend, zodat een gat aantoonbaar is.
CREATE UNIQUE INDEX "AuditEvent_seq_key" ON "AuditEvent"("seq");
