#!/usr/bin/env bash
# Zet een back-up terug in een WEGGOOI-omgeving en controleert of er echt iets
# bruikbaars uit komt. Een back-up die je nooit hebt teruggezet, is geen back-up.
#
# Draai dit minstens één keer per kwartaal en leg de uitkomst vast in het
# kwaliteitshandboek.
#
#   scripts/restore-test.sh /var/backups/ovp-portaal/20260724T020000Z
#
# Raakt de productieomgeving niet aan: er komt een aparte database en een aparte
# map, en die worden aan het eind opgeruimd.
set -euo pipefail

cd "$(dirname "$0")/.."
BACKUP="${1:-}"
[[ -n "$BACKUP" && -d "$BACKUP" ]] || { echo "Gebruik: $0 <back-upmap>" >&2; exit 1; }

WORK="$(mktemp -d)"
TEST_DB="ovp_restoretest_$(date +%s)"
CONTAINER="ovp-restoretest-db"
cleanup() {
  echo
  echo "opruimen…"
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

decrypt() {
  # $1 = pad zonder extensie; schrijft platte tekst naar stdout.
  if [[ -f "$1.age" ]]; then
    age --decrypt -i "${AGE_IDENTITY:?zet AGE_IDENTITY naar je age-sleutelbestand}" "$1.age"
  elif [[ -f "$1.gpg" ]]; then
    gpg --batch --quiet --decrypt "$1.gpg"
  else
    echo "FOUT: geen $1.age of $1.gpg gevonden" >&2
    return 1
  fi
}

echo "=== 1. Back-up ontsleutelen ==="
decrypt "$BACKUP/database.dump" > "$WORK/database.dump"
mkdir -p "$WORK/documents"
decrypt "$BACKUP/documents.tar" | tar -xf - -C "$WORK/documents"
echo "  database.dump: $(du -h "$WORK/database.dump" | cut -f1)"
echo "  documenten:    $(find "$WORK/documents" -type f | wc -l) bestand(en)"

echo
echo "=== 2. Losse database starten ==="
docker run -d --name "$CONTAINER" \
  -e POSTGRES_PASSWORD=restoretest \
  -e POSTGRES_USER=ovp \
  -e POSTGRES_DB="$TEST_DB" \
  -p 55432:5432 postgres:16 >/dev/null
printf '  wachten op de database'
for _ in $(seq 1 60); do
  if docker exec "$CONTAINER" pg_isready -U ovp >/dev/null 2>&1; then break; fi
  printf '.'; sleep 1
done
echo ' gereed'

echo
echo "=== 3. Terugzetten ==="
docker cp "$WORK/database.dump" "$CONTAINER:/tmp/database.dump"
docker exec "$CONTAINER" pg_restore --username ovp --dbname "$TEST_DB" --no-owner /tmp/database.dump \
  || echo "  (pg_restore meldde waarschuwingen; dat is bij --no-owner normaal)"

echo
echo "=== 4. Inhoud controleren ==="
export DATABASE_URL="postgresql://ovp:restoretest@localhost:55432/$TEST_DB?schema=public"
export STORAGE_DIR="$WORK/documents"
# STORAGE_ENCRYPTION_KEY moet uit je sleutelkluis komen, niet uit de back-up.
: "${STORAGE_ENCRYPTION_KEY:?zet STORAGE_ENCRYPTION_KEY (uit de sleutelkluis) om de documenten te kunnen lezen}"
npm run --silent restore:verify

echo
echo "=== Klaar ==="
echo "Leg de uitkomst vast: datum, wie het deed, en of de controle slaagde."
