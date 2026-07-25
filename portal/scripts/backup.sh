#!/usr/bin/env bash
# Versleutelde back-up van de database én het documentvolume.
#
# Draai dit dagelijks vanaf de host (niet in de container), bijvoorbeeld via cron:
#   0 2 * * *  /pad/naar/portal/scripts/backup.sh >> /var/log/ovp-backup.log 2>&1
#
# Belangrijk: de encryptiesleutels horen NIET in deze back-up. Anders back-up je
# het slot met de sleutel erin. Bewaar .env apart, in een sleutelkluis.
set -euo pipefail

cd "$(dirname "$0")/.."

BACKUP_DIR="${BACKUP_DIR:-/var/backups/ovp-portaal}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TARGET="$BACKUP_DIR/$STAMP"

# Publieke sleutel om de back-up te versleutelen. Gebruik age (aanbevolen) of gpg.
#   AGE_RECIPIENT="age1..."           -> versleutelt met age
#   GPG_RECIPIENT="backup@kantoor.nl" -> versleutelt met gpg
AGE_RECIPIENT="${AGE_RECIPIENT:-}"
GPG_RECIPIENT="${GPG_RECIPIENT:-}"

if [[ -z "$AGE_RECIPIENT" && -z "$GPG_RECIPIENT" ]]; then
  echo "FOUT: zet AGE_RECIPIENT of GPG_RECIPIENT. Een onversleutelde back-up van" >&2
  echo "      cliëntdossiers is geen optie." >&2
  exit 1
fi

encrypt_to() {
  # Leest van stdin, schrijft versleuteld naar $1.
  if [[ -n "$AGE_RECIPIENT" ]]; then
    age -r "$AGE_RECIPIENT" -o "$1.age"
  else
    gpg --batch --yes --encrypt --recipient "$GPG_RECIPIENT" --output "$1.gpg"
  fi
}

mkdir -p "$TARGET"
echo "[$(date -u +%FT%TZ)] back-up naar $TARGET"

# --- 1. Database ---
# pg_dump vanuit de db-container, zodat de versie altijd klopt.
echo "  database…"
docker compose exec -T db pg_dump \
  --username "${POSTGRES_USER:-ovp}" \
  --dbname "${POSTGRES_DB:-ovp_portaal}" \
  --format=custom --no-owner \
  | encrypt_to "$TARGET/database.dump"

# --- 2. Documentvolume ---
# De bestanden zijn al versleuteld met de opslagsleutel; we versleutelen de
# back-up daar bovenop, zodat één laag verliezen niet meteen alles blootlegt.
echo "  documenten…"
docker compose run --rm --no-deps -T \
  -v ovp_documents:/data/documents:ro \
  --entrypoint sh web -c 'tar -cf - -C /data/documents .' 2>/dev/null \
  | encrypt_to "$TARGET/documents.tar" \
  || {
    # Terugval: volumenaam kan per project afwijken.
    echo "  (compose-run mislukte, probeer docker run met de gevonden volumenaam)"
    VOL="$(docker volume ls --format '{{.Name}}' | grep -m1 'documents' || true)"
    [[ -n "$VOL" ]] || { echo "FOUT: documentvolume niet gevonden" >&2; exit 1; }
    docker run --rm -v "$VOL":/data:ro alpine tar -cf - -C /data . \
      | encrypt_to "$TARGET/documents.tar"
  }

# --- 3. Bijschrift ---
cat > "$TARGET/README.txt" <<EOF
Back-up ondertekenportaal Otto Visser & Partners
Gemaakt: $STAMP (UTC)

Inhoud:
  database.dump.*   pg_dump in custom-formaat (herstel met pg_restore)
  documents.tar.*   inhoud van het documentvolume

NIET in deze back-up (bewust): .env en de encryptiesleutels. Zonder
STORAGE_ENCRYPTION_KEY zijn de documenten niet te lezen. Bewaar die sleutels
apart in een sleutelkluis, en houd oude sleutelversies zolang er back-ups van
vóór een rotatie bestaan.

Herstellen en controleren: scripts/restore-test.sh
EOF

chmod -R go-rwx "$TARGET"
echo "  klaar: $(du -sh "$TARGET" | cut -f1)"

# --- 4. Oude back-ups opruimen ---
find "$BACKUP_DIR" -mindepth 1 -maxdepth 1 -type d -mtime "+$KEEP_DAYS" -print -exec rm -rf {} + || true

echo "[$(date -u +%FT%TZ)] gereed"
echo
echo "LET OP: een back-up die je nooit hebt teruggezet, is geen back-up."
echo "Draai minstens één keer per kwartaal scripts/restore-test.sh."
