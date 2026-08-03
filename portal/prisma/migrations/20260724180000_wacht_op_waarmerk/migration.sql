-- Dossier wacht op de gekwalificeerde handtekening van de accountant, die
-- daarvoor zelf moet autoriseren. Geen foutstatus, maar een normale wachtstand.
ALTER TYPE "DossierStatus" ADD VALUE 'WACHT_OP_WAARMERK';
