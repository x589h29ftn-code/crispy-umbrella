#!/usr/bin/env bash
# Back-up met restic naar een externe opslag (bijv. een Hetzner Storage Box).
#
# Waarom naast scripts/backup.sh. Dat script maakt losse versleutelde bestanden op
# de server zelf; prima om te beginnen, maar een back-up die op dezelfde machine
# staat is geen back-up. restic doet dedupliceerde, incrementele, versleutelde
# back-ups naar een andere plek, en kan terugzetten naar een willekeurig moment.
#
# Versleutelen gebeurt VOOR het uploaden (restic doet dat zelf, met een wachtwoord
# dat alleen jij hebt). De jurisdictie van de opslagpartij doet daardoor praktisch
# niet mee: die ziet alleen onleesbare blokken.
#
# PRIORITEITEN, en die zijn met changeset v1.4 veranderd:
#
#   Postgres           dagelijks, volledig    <- dit is het kroonjuweel: 7 jaar
#                                               auditspoor en alle metadata
#   documentenvolume   wekelijks              <- staat er maar 90 dagen, en het
#                                               archief zelf is SharePoint
#   .env en sleutels   APART, niet hierin     <- anders back-up je het slot met de
#                                               sleutel erin
#
# Draaien vanaf de host (niet in de container):
#   0 2 * * *  RESTIC_REPOSITORY=... RESTIC_PASSWORD_FILE=... /pad/scripts/backup-restic.sh
#
# Eenmalig initialiseren:
#   restic init
set -euo pipefail

cd "$(dirname "$0")/.."

: "${RESTIC_REPOSITORY:?zet RESTIC_REPOSITORY, bijv. sftp:u123456@u123456.your-storagebox.de:/ovp-portaal}"
if [[ -z "${RESTIC_PASSWORD_FILE:-}" && -z "${RESTIC_PASSWORD:-}" ]]; then
  echo "FOUT: zet RESTIC_PASSWORD_FILE (aanbevolen) of RESTIC_PASSWORD." >&2
  echo "      Zonder dat wachtwoord is de back-up straks niet terug te zetten." >&2
  exit 1
fi

DB_USER="${POSTGRES_USER:-ovp}"
DB_NAME="${POSTGRES_DB:-ovp_portaal}"
DOCS_VOLUME="${DOCS_VOLUME:-/var/lib/docker/volumes/portal_documents/_data}"
# Wekelijks de documenten mee: standaard op maandag.
DOCS_DAY="${DOCS_DAY:-1}"

echo "== restic back-up $(date -u +%FT%TZ) =="

# --- 1. Database: volledige dump, rechtstreeks in restic (nooit op schijf) ---
echo "-- Postgres ($DB_NAME)"
docker compose exec -T db pg_dump -U "$DB_USER" --clean --if-exists "$DB_NAME" \
  | restic backup --stdin --stdin-filename "postgres-${DB_NAME}.sql" --tag db --tag dagelijks

# --- 2. Documenten: wekelijks, incrementeel ---
if [[ "$(date -u +%u)" == "$DOCS_DAY" ]]; then
  if [[ -d "$DOCS_VOLUME" ]]; then
    echo "-- documentenvolume ($DOCS_VOLUME)"
    restic backup "$DOCS_VOLUME" --tag documenten --tag wekelijks
  else
    echo "WAARSCHUWING: $DOCS_VOLUME niet gevonden; zet DOCS_VOLUME goed." >&2
  fi
else
  echo "-- documentenvolume: vandaag niet (DOCS_DAY=$DOCS_DAY)"
fi

# --- 3. Oude momentopnamen opruimen ---
# Ruim genomen: het auditspoor moet zeven jaar mee, maar daarvoor is de LAATSTE
# dump genoeg — oudere versies zijn er voor het geval iets ongemerkt is gewist.
echo "-- opruimen"
restic forget \
  --keep-daily 14 \
  --keep-weekly 8 \
  --keep-monthly 24 \
  --keep-yearly 7 \
  --prune

# --- 4. Controleren dat de repository leesbaar is ---
# Niet elke dag alle data (dat kost bandbreedte), maar wel de structuur plus een
# steekproef van 5% van de blokken.
echo "-- controle"
restic check --read-data-subset=5%

echo "== klaar =="
echo
echo "Terugzetten van de laatste database-dump:"
echo "  restic dump latest postgres-${DB_NAME}.sql | docker compose exec -T db psql -U $DB_USER $DB_NAME"
echo
echo "LET OP: .env en de encryptiesleutels zitten NIET in deze back-up."
echo "Zonder die sleutels zijn de documenten na een restore onleesbaar."
echo "Bewaar ze in de sleutelkluis, en test één keer per kwartaal een echte restore"
echo "met scripts/restore-test.sh."
