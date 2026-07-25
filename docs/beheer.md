# Beheer: back-up, bewaartermijn en sleutels

Praktische taken voor de beheerder. Voor de verzegeling en het beroepscertificaat
zie `verzegeling.md`.

## Back-up — begin hier

Dit is het grootste enkelvoudige risico. Een auditspoor dat je kwijt bent,
bestond nooit.

### Dagelijks

```bash
export AGE_RECIPIENT="age1..."        # of GPG_RECIPIENT
export BACKUP_DIR=/var/backups/ovp-portaal
scripts/backup.sh
```

Zet dit in cron op de host (niet in de container):

```
0 2 * * *  AGE_RECIPIENT=age1... /pad/naar/portal/scripts/backup.sh >> /var/log/ovp-backup.log 2>&1
```

Het script maakt een versleutelde `pg_dump` én een versleutelde kopie van het
documentvolume, en ruimt back-ups ouder dan 30 dagen op (`KEEP_DAYS`).

> **De sleutels horen niet in de back-up.** `.env` en `STORAGE_ENCRYPTION_KEY`
> bewaar je apart, in een sleutelkluis. Anders back-up je het slot met de sleutel
> erin.

### Elk kwartaal: terugzetten en controleren

Een back-up die je nooit hebt teruggezet, is geen back-up.

```bash
export AGE_IDENTITY=/pad/naar/age-sleutel
export STORAGE_ENCRYPTION_KEY="..."   # uit de sleutelkluis
scripts/restore-test.sh /var/backups/ovp-portaal/20260724T020000Z
```

Dit zet de back-up terug in een **weggooi**-database (poort 55432) en een tijdelijke
map, en controleert daarna of er echt iets bruikbaars uit komt:

- staan er dossiers en een auditspoor in?
- is de hashketen intact?
- zijn de documenten te ontsleutelen en klopt hun hash?
- valideert een verzegeld document nog?

De productieomgeving wordt niet aangeraakt en alles wordt aan het eind opgeruimd.
**Leg de uitkomst vast** in het kwaliteitshandboek: datum, wie het deed, en of het
slaagde.

## Bewaartermijn

Afgeronde dossiers krijgen automatisch `retentionUntil` op **zeven jaar** na
afronding. De worker loopt dat dagelijks na.

Handmatig bekijken of uitvoeren:

```bash
npm run retention:purge            # laat zien wat er zou gebeuren
npm run retention:purge -- --apply # voert het uit (niet terug te draaien)
```

Het document en het bewijsdossier verdwijnen **altijd samen**, in één transactie.
Een ondertekend document zonder auditspoor is waardeloos, en een auditspoor zonder
document ook.

## Auditspoor controleren

```bash
npm run audit:verify
```

De keten loopt **per dossier**. Dat is bewust: de bewaartermijn ruimt een compleet
dossier op, en bij één globale keten zou zo'n legitieme opruiming de keten breken —
een keten die altijd "gebroken" is beschermt niets.

Wat dit aantoont:

- ✅ elke wijziging aan een auditregel
- ✅ het verwijderen van een regel middenin een dossier
- ❌ het verwijderen van de oudste regels van een dossier is niet aan de keten
  zelf te zien; daarvoor zou een anker buiten de database nodig zijn

Daarnaast weigert de database zelf (via een trigger) elke UPDATE en DELETE op het
auditspoor. Alleen de geplande opruiming zet die kortstondig uit, binnen één
transactie.

## Sleutelrotatie

De sleutelversie staat **in de data zelf**, niet in de database. Een bestand is
dus altijd te lezen zolang de bijbehorende sleutel er is, en bestaande data van
vóór deze wijziging blijft werken.

Roteren in drie stappen, zonder downtime:

**1. Nieuwe sleutel toevoegen**

```
STORAGE_ENCRYPTION_KEY="<oude sleutel>"        # blijft staan, is versie 1
STORAGE_ENCRYPTION_KEY_V2="<nieuwe sleutel>"
STORAGE_ENCRYPTION_KEY_CURRENT="2"
```

Herstart. Nieuwe data gaat vanaf nu met versie 2; oude data blijft leesbaar.

**2. Bestaande data herschrijven**

```bash
npm run keys:rotate              # laat zien wat er zou gebeuren
npm run keys:rotate -- --apply   # voert het uit
```

**3. Oude sleutel opruimen**

Meldt het script dat alles op de huidige versie staat, dan mag versie 1 uit de
omgeving. **Bewaar hem nog wel in de sleutelkluis** zolang er back-ups van vóór de
rotatie bestaan — die zijn nog met versie 1 versleuteld.

Hetzelfde geldt voor `TOTP_ENCRYPTION_KEY`.

> Raakt een sleutel kwijt terwijl er nog data mee is versleuteld, dan is die data
> definitief onleesbaar. Het portaal geeft dan een expliciete melding met het
> versienummer dat ontbreekt, in plaats van een cryptische fout.

## Schaal

De rate-limiting werkt in het geheugen van de webcontainer. Dat is prima bij één
container. Draai je er ooit meer dan één, dan gelden de limieten per container en
is de bescherming feitelijk verzwakt; zet dan `rate-limiter-flexible` om naar de
Postgres-backend. Zolang er één webcontainer draait, is dit geen probleem.

## Achtergrondtaken

De `worker`-container verwerkt de wachtrij (tabel `Job`) en plant terugkerende
taken zelf opnieuw in:

| Taak | Wanneer |
|---|---|
| `SEAL_RETRY` | na een mislukte verzegeling, met oplopende tussentijd |
| `MAIL_RESEND` | één uur na een tijdelijke bounce |
| `CSC_SESSION_CLEANUP` | elke 5 minuten |
| `RETENTION_CLEANUP` | elke 24 uur |

Houd het op **één** worker-instance.
