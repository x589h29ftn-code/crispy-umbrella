#!/usr/bin/env bash
# Uitrollen op de server.
#
# Waarom een script en niet "docker compose up -d --build": op een machine van 4 GB
# met 40 GB schijf zijn er twee dingen die stilletjes misgaan.
#
#  1. Een Next.js-build vraagt 2 tot 4 GB naast de draaiende containers. Bouwen op
#     deze server kan de app die er al staat het geheugen uit duwen. Daarom bouwen we
#     bij voorkeur elders (CI) en pullt de server alleen. Zonder register valt dit
#     script terug op bouwen op de server, met een waarschuwing.
#  2. Oude images blijven staan. Dat is bij 40 GB het enige dat de schijf realistisch
#     laat vollopen, en een volle schijf betekent geen uploads meer en geen back-up.
#     Daarom ruimt dit script op en houdt hij twee generaties.
set -euo pipefail
cd "$(dirname "$0")/.."

REGISTRY="${REGISTRY:-}"
KEEP_IMAGES="${KEEP_IMAGES:-2}"

echo "== uitrollen $(date -u +%FT%TZ) =="

# Voor de zekerheid: hoeveel ruimte is er nog?
BESCHIKBAAR_MB="$(df -Pm . | awk 'NR==2 {print $4}')"
echo "-- vrije schijfruimte: ${BESCHIKBAAR_MB} MB"
if [[ "$BESCHIKBAAR_MB" -lt 5000 ]]; then
  echo "WAARSCHUWING: minder dan 5 GB vrij. Ruim eerst op (zie docs/beheer.md)." >&2
fi

git pull --ff-only

if [[ -n "$REGISTRY" ]]; then
  echo "-- images ophalen uit $REGISTRY (gebouwd in CI)"
  docker compose pull
else
  echo "WAARSCHUWING: geen REGISTRY gezet, dus er wordt op deze server gebouwd." >&2
  echo "             Een Next.js-build vraagt 2 tot 4 GB. Bij krapte: bouw in CI en" >&2
  echo "             zet REGISTRY, dan pullt de server alleen." >&2
  docker compose build
fi

echo "-- starten"
docker compose up -d

echo "-- migraties"
# De web-container voert bij het opstarten zelf `prisma migrate deploy` uit; deze
# regel maakt alleen zichtbaar of dat is gelukt.
docker compose logs --tail=30 web | grep -i "migrat" || true

echo "-- oude images opruimen (${KEEP_IMAGES} generaties bewaren)"
# Dangling images kunnen altijd weg.
docker image prune -f >/dev/null
# Van onze eigen images de oudste weghalen, per naam.
for naam in $(docker images --format '{{.Repository}}' | grep -E 'portal|signaturing' | sort -u); do
  # shellcheck disable=SC2046
  oude=$(docker images "$naam" --format '{{.ID}} {{.CreatedAt}}' | sort -k2 -r | tail -n +$((KEEP_IMAGES + 1)) | awk '{print $1}')
  for id in $oude; do
    docker rmi "$id" >/dev/null 2>&1 || true
  done
done

echo "-- stand"
docker compose ps
df -h . | tail -1

echo "== klaar =="
