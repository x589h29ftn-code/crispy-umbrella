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
- ✅ het afknippen van de kop van een keten (de eerste regel verwijst dan naar een
  voorganger die niet meer bestaat)
- ❌ het volledig verwijderen van een dossier mét zijn hele keten is niet aan de
  keten zelf te zien; daarvoor zou een anker buiten de database nodig zijn

Schrijven gebeurt onder een advisory lock per keten. Zonder die vergrendeling
lezen twee ondertekenaars die op hetzelfde moment indienen dezelfde laatste regel,
verwijzen beide nieuwe regels naar dezelfde voorganger, en vorkt de keten. De
controle zou daarna voor altijd een breuk melden die niemand heeft veroorzaakt —
en een controle die altijd rood staat, wordt genegeerd.

Daarnaast weigert de database zelf (via een trigger) elke UPDATE en DELETE op het
auditspoor. Alleen de geplande opruiming zet die kortstondig uit, binnen één
transactie, met `SET LOCAL app.audit_purge = 'on'`.

**Wat die trigger wél en niet tegenhoudt.** Hij beschermt tegen een fout in de
applicatie (een verkeerde `update`/`delete` die per ongeluk het auditspoor raakt)
en tegen iemand die alleen databasetoegang heeft en niet weet van de
noodschakelaar. Hij beschermt **niet** tegen een beheerder met volledige rechten op
de database: die kan dezelfde schakelaar zetten, of de trigger uitschakelen. Wie
dat wil dichtzetten heeft een anker buiten de database nodig — een append-only
logdienst of een dagelijkse hash naar een externe plek. Zolang dat er niet is,
geldt: het auditspoor is aantoonbaar onaangetast tegenover *de applicatie*, niet
tegenover *de databasebeheerder*.

Het opruimen na de bewaartermijn laat wel een grafsteen achter
(`BEWAARTERMIJN_OPGERUIMD`) met het aantal verwijderde regels en de laatste hash van
de opgeruimde keten. Een dossier verdwijnt dus nooit helemaal zonder spoor.

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

De rate-limiting staat sinds v1.3 in **Postgres** (tabel `RateLimit`), niet meer in
het geheugen van de webcontainer. De eerdere onderbouwing ("we draaien één
container") klopte, maar de manier waarop het stukgaat is te makkelijk: één
`docker compose up --scale web=2` en de limieten gelden per container, dus feitelijk
het dubbele. Het volume is triviaal — een handvol rijen per dag.

Valt de database weg, dan gaan de limieten **niet** open: er staat een in-memory
achtervang met dezelfde instellingen achter, zodat een databasestoring geen
brute-force-venster opent.

Met `RATE_LIMIT_STORE=memory` zet je het terug in het geheugen; dat is er voor tests
zonder database, niet voor productie.

## Achtergrondtaken

De `worker`-container verwerkt de wachtrij (tabel `Job`) en plant terugkerende
taken zelf opnieuw in:

| Taak | Wanneer |
|---|---|
| `SEAL_RETRY` | na een mislukte verzegeling, met oplopende tussentijd (max 12 pogingen) |
| `MAIL_RESEND` | één uur na een tijdelijke bounce |
| `REMINDER` | elk uur; verstuurt herinneringen op dag 5 en 12 na verzending |
| `EXPIRE` | elk uur; zet verlopen verzoeken op VERLOPEN en meldt het de eigenaar |
| `WAARMERK_NUDGE` | elk uur; port de eigenaar na 3 dagen wachten op zijn waarmerk |
| `CSC_SESSION_CLEANUP` | elke 5 minuten |
| `ORPHAN_CLEANUP` | elke 6 uur; losse blobs ouder dan 24 uur |
| `AUDIT_ANCHOR` | dagelijks, plus één keer per afgerond dossier |
| `RETENTION_CLEANUP` | elke 24 uur |

Een herinnering wordt **niet** verstuurd als de tekenlink binnen 24 uur verloopt: een
link die niet werkt is erger dan stilte. Bij `linkTtlDays = 7` valt de tweede
herinnering dus weg. Mislukt het versturen (mailserver even weg), dan blijft de
teller staan en probeert de volgende ronde het opnieuw.

Houd het op **één** worker-instance.

## Losse bestanden en een volle schijf

Elke bewerking van een document schrijft een **nieuwe** versleutelde blob; de
database verplaatst alleen de verwijzing. Dat is bewust: zou een bewerking hetzelfde
bestand overschrijven, dan is bij een teruggerolde transactie de blob wél gewijzigd
en de database niet, en stempelt de volgende ondertekenaar op een bestand dat volgens
de administratie nog onbewerkt is.

De keerzijde is dat er af en toe een blob achterblijft waar niets naar verwijst: een
transactie die terugrolde, een verlopen ondertekensessie, een verwijdering die na de
commit mislukte. De taak `ORPHAN_CLEANUP` ruimt die op, **alleen als ze ouder zijn
dan 24 uur**. Die marge is niet optioneel: zonder marge haalt de opruiming een
bestand weg waarvan de commit nog loopt. De taak logt eerst wat hij zou verwijderen
en doet het daarna.

Dat verschuift de faalmodus van "half geschreven bestand" naar "volume loopt vol".
Dat is een betere faalmodus, maar het is er wel een:

```bash
df -h /var/lib/docker/volumes           # of waar het documents-volume staat
docker compose exec web du -sh /data/documents
docker compose logs worker | grep "losse bestanden"
```

Loopt het vol, kijk dan eerst of de opruimtaak draait (de regel hierboven in het
logboek) en of hij fouten meldt. Handmatig opruimen kan met dezelfde functie via de
worker; verwijder **nooit** met de hand bestanden uit `/data/documents`, want een
sleutel die nog in de database staat en waarvan de blob weg is, is dataverlies.

> Let op bij herverzegelen: verandert `sealedKey`, dan klopt een eerder
> gearchiveerde kopie niet meer met de database. Het portaal logt dat expliciet
> (`GEARCHIVEERD`) in plaats van stil te overschrijven.

## Externe gereedschappen: wat de "sandbox" wél en niet is

LibreOffice (Word→PDF), tesseract en pdftoppm werken op bestanden die van buiten
komen. Ze worden aangeroepen met:

- een eigen tijdelijke map als werkmap én als `HOME`, die daarna wordt verwijderd;
- een **uitgeklede omgeving**: geen proxyvariabelen, geen tokens, geen
  databasewachtwoord, geen sleutels;
- een harde tijdslimiet en een limiet op de uitvoer.

**Wat het níet is: netwerktoegang blokkeren.** Deze processen draaien in de
webcontainer, en die heeft netwerk nodig voor de sealer, SMTP en de provider-API's.
Eerdere documentatie beweerde dat de conversie "geen netwerk" had; dat was te sterk
en is nu bijgesteld. Wie het echt dicht wil, zet de conversie in een eigen container
met `network_mode: none`. Dat is een bewuste openstaande keuze, niet een vergissing.

## Bekende grens: de dossierloze auditketen

Regels zonder dossier (inloggen, certificaat ingetrokken, grafstenen) vormen samen
één keten, en die keten heeft één schrijver tegelijk. Bij zeven medewerkers is dat
volledig irrelevant. Zou het portaal ooit veel groter worden en gaan inloggen
knellen, dan is de oplossing die keten te splitsen — bijvoorbeeld per maand of per
accountant. Doe daar nu niets aan; het staat hier zodat het over drie jaar geen
zoekplaatje is.

## Regressietests

Een klein pakket scripts dat de afspraken controleert die je niet met het oog kunt
nazien. Ze draaien tegen een **testdatabase** — nooit tegen productie, want ze maken
en verwijderen dossiers en breken opzettelijk een hashketen.

```bash
npm run test:regressie      # alles achter elkaar
npm run test:opstart        # de harde weigeringen bij opstarten
npm run test:audit          # hashketen, append-only trigger, bewaartermijn, certificaat
npm run test:gelijktijdig   # twee ondertekenaars op hetzelfde moment
npm run test:sessie         # ondertekensessie: versleuteld bewaren en wissen
npm run test:levensloop     # herinneren, verlopen, opnieuw verzenden, nudge
npm run test:opslag         # opslagsleutels, losse bestanden, grendels
```

De sealer heeft een eigen test met een zelfondertekend testcertificaat (idempotentie,
manipulatiedetectie, en dat de controlepagina niets van internet ophaalt):

```bash
python -m venv .venv-sealer
.venv-sealer/bin/pip install -r sealer/requirements.txt
.venv-sealer/bin/python scripts/regressie/sealer.py
```
