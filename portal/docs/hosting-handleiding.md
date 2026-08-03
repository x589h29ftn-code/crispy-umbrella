# Hostinghandleiding Ondertekenportaal

Stap voor stap: de app van GitHub halen en zelf hosten op een eigen server, met
HTTPS en e-mail. Bedoeld om gewoon van boven naar beneden te volgen. Je hoeft
geen ervaren serverbeheerder te zijn; kopieer de commando's een voor een.

De commando's gaan uit van een verse **Ubuntu 22.04/24.04**-server. Zit je op een
ander systeem, dan zijn alleen de installatiestappen (deel A) net anders.

---

## 0. Wat je vooraf nodig hebt

1. **Een server (VPS) in de EU.** Bijvoorbeeld bij Hetzner, TransIP of Leaseweb.
   Richtlijn: 2 vCPU, 4 GB RAM, 40 GB schijf. Kies een Europese locatie (AVG).
2. **Een (sub)domein**, bijvoorbeeld `portaal.ottovisseraccountants.nl`, en toegang
   tot je DNS-beheer om een record aan te maken.
3. **Een e-mailaccount om vanaf te versturen.** Microsoft 365 werkt out of the box.
   Zorg dat "Authenticated SMTP" aanstaat voor dat postvak (zie deel F).
4. **Het IP-adres van je server** en de inloggegevens (die krijg je van je hoster).

Tijd: reken op ongeveer 30 tot 45 minuten.

---

## A. Server klaarmaken (Docker installeren)

Log in op de server vanaf je eigen computer (vervang het IP):

```bash
ssh root@JOUW_SERVER_IP
```

Installeer Docker (officieel script) en zet de firewall goed:

```bash
# Docker + Docker Compose installeren
curl -fsSL https://get.docker.com | sh

# Firewall: SSH, HTTP en HTTPS open, de rest dicht
apt-get update && apt-get install -y ufw
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable
```

Controleer dat Docker draait:

```bash
docker --version
docker compose version
```

Zie je van beide een versienummer, dan is deel A klaar.

---

## B. DNS instellen (je domein naar de server wijzen)

Ga naar je DNS-beheer en maak één record aan:

| Type | Naam                                   | Waarde            |
| ---- | -------------------------------------- | ----------------- |
| A    | `portaal` (of het volledige subdomein) | `JOUW_SERVER_IP`  |

Voorbeeld: `portaal.ottovisseraccountants.nl` wijst naar het IP van je server.

Wacht tot het record actief is (meestal enkele minuten). Controleer eventueel:

```bash
ping portaal.ottovisseraccountants.nl
```

> Dit record is nodig voordat je start, want de server vraagt automatisch een
> HTTPS-certificaat aan op dit domein.

---

## C. De code van GitHub halen

Nog steeds ingelogd op de server:

```bash
cd /opt
git clone https://github.com/x589h29ftn-code/signaturing.git
cd signaturing
```

Alle bestanden staan nu in `/opt/signaturing`. Dit is de map waarin je verder werkt.

---

## D. Configureren (het bestand `.env`)

Alle instellingen en geheimen komen in één bestand: `.env`. Maak het aan vanuit
het voorbeeld:

```bash
cp .env.example .env
```

### D1. Geheimen genereren

De app heeft vier geheime sleutels plus een database-wachtwoord nodig. Genereer
er vijf met dit commando (voer het vijf keer uit en bewaar de uitkomsten):

```bash
openssl rand -base64 48
```

### D2. Het bestand invullen

Open het bestand:

```bash
nano .env
```

Vul de volgende regels in. Onderstaande tabel legt elk veld uit.

| Veld                    | Wat je invult                                                                 |
| ----------------------- | ----------------------------------------------------------------------------- |
| `APP_URL`               | `https://` + je domein, bijv. `https://portaal.ottovisseraccountants.nl`      |
| `PORTAL_DOMAIN`         | Je domein zonder https, bijv. `portaal.ottovisseraccountants.nl`              |
| `POSTGRES_PASSWORD`     | Een van je gegenereerde geheimen (database-wachtwoord)                         |
| `SESSION_SECRET`        | Een gegenereerd geheim                                                         |
| `SIGNING_TOKEN_SECRET`  | Een ander gegenereerd geheim                                                   |
| `STORAGE_ENCRYPTION_KEY`| Een ander gegenereerd geheim (versleutelt de documenten)                       |
| `TOTP_ENCRYPTION_KEY`   | Een ander gegenereerd geheim (versleutelt de 2FA-sleutels)                     |
| `SMTP_HOST`             | `smtp.office365.com` (Microsoft 365)                                           |
| `SMTP_PORT`             | `587`                                                                          |
| `SMTP_SECURE`           | `false` (poort 587 gebruikt STARTTLS)                                          |
| `SMTP_USER`             | Het e-mailadres waarmee je verstuurt, bijv. `noreply@ottovisseraccountants.nl`|
| `SMTP_PASS`             | Het wachtwoord (of app-wachtwoord) van dat e-mailaccount                       |
| `MAIL_FROM`             | `Otto Visser & Partners <noreply@ottovisseraccountants.nl>`                    |
| `SEED_ADMIN_EMAIL`      | Jouw e-mailadres (je eerste inlog als beheerder)                               |
| `SEED_ADMIN_PASSWORD`   | Een tijdelijk sterk wachtwoord (wijzig je bij de eerste login)                 |
| `SEED_ADMIN_NAME`       | Je naam, bijv. `Mark`                                                          |

> **Belangrijk:** gebruik voor elk van de vier geheime sleutels en het
> database-wachtwoord een **andere** waarde. Deel deze nooit en bewaar ze veilig
> (bijv. in je wachtwoordmanager). Wie deze sleutels heeft, kan bij de gegevens.

De regel `DATABASE_URL` hoef je niet aan te passen: docker-compose vult die
automatisch met je `POSTGRES_PASSWORD`.

Opslaan in nano: `Ctrl+O`, `Enter`, daarna `Ctrl+X`.

---

## E. Starten

Bouw en start alles met één commando:

```bash
docker compose up -d --build
```

De eerste keer duurt dit een paar minuten (de app wordt gebouwd). Wat er gebeurt:

- **db**: de PostgreSQL-database (niet publiek bereikbaar).
- **web**: de app zelf; voert automatisch de database-migraties uit en start.
- **caddy**: regelt automatisch HTTPS (Let's Encrypt) op jouw domein.

Controleer of alles draait:

```bash
docker compose ps
```

Alle drie de services horen op `running` te staan. Logs bekijken kan met:

```bash
docker compose logs -f web
```

(stoppen met kijken: `Ctrl+C`)

### E1. De eerste beheerder aanmaken

De database is nog leeg. Maak je eerste inlogaccount aan (leest de
`SEED_ADMIN_*`-gegevens uit je `.env`):

```bash
docker compose exec web npm run db:seed
```

Je ziet `Beheerder klaar: <jouw e-mailadres>`. Dit hoef je maar één keer te doen.

---

## F. Eerste keer inloggen

1. Open in je browser `https://` + je domein (bijv.
   `https://portaal.ottovisseraccountants.nl`). Het slotje hoort groen/dicht te
   zijn (geldig HTTPS-certificaat).
2. Log in met het `SEED_ADMIN_EMAIL` en `SEED_ADMIN_PASSWORD` uit je `.env`.
3. Je wordt gevraagd een **eigen wachtwoord** te kiezen en **tweefactor (2FA)** in
   te stellen. Scan de QR-code met een authenticator-app (bijv. Microsoft
   Authenticator of Google Authenticator) en voer de code in.
4. Ga naar **Instellingen** en zet je **eigen handtekening** (die plaats je later
   met één klik op documenten die je zelf tekent).
5. Voeg via **Gebruikers** je collega's toe en via **Cliënten** je klanten (of
   importeer ze in bulk met een CSV; er staat een voorbeeldbestand in de app).

Klaar. Je kunt nu een dossier aanmaken, documenten uploaden en laten ondertekenen.

---

## G. Microsoft 365 e-mail: aandachtspunten

De app verstuurt uitnodigingen, verificatiecodes en de afgeronde documenten per
e-mail. Voor Microsoft 365:

- Zet **Authenticated SMTP** aan voor het postvak (Microsoft 365-beheer, onder de
  postvakinstellingen). Zonder dit weigert Microsoft de verzending.
- Staat er tweefactor op dat postvak, maak dan een **app-wachtwoord** aan en zet
  dat in `SMTP_PASS`.
- Voor goede bezorgbaarheid (niet in de spam): stel **SPF**, **DKIM** en **DMARC**
  in op het domein van `MAIL_FROM`, en laat het afzenderadres met dat domein
  overeenkomen.

---

## G2. Afvinklijst voor het moment dat er een certificaat is

Zolang `SEAL_MODE=none` staat, verzegelt het portaal niet. Zodra het kantoor een
beroepscertificaat heeft:

```
SEAL_MODE="qualified"
PROFESSIONAL_SIGNING_DRIVER="cleverbase"
CLEVERBASE_CSC_BASE_URL="..."
CLEVERBASE_CSC_CLIENT_ID="..."
CLEVERBASE_CSC_CLIENT_SECRET="..."
CLEVERBASE_CSC_ENV="production"
CLEVERBASE_REDIRECT_URI="https://<jouw domein>/api/csc/callback"
TSA_URL="https://<tijdstempeldienst>/tsr"
SEALER_SHARED_SECRET="<openssl rand -base64 48>"
```

Zet daarna per accountant het certificaat aan onder **Instellingen → Gebruikers**.

**De app weigert te starten** met `SEAL_MODE=qualified` terwijl
`PROFESSIONAL_SIGNING_DRIVER=none` staat. Dat is bewust: er zou dan niets worden
verzegeld terwijl de configuratie zegt van wel, en niets in de status zou het
verraden. De foutmelding vertelt wat je moet doen.

Er is **geen** organisatiecertificaat nodig. Het beroepscertificaat is de
handtekening; één mechanisme in plaats van twee.

### Als /valideren ooit publiek moet worden

Nu staat de controlepagina achter de login, en daarmee is er geen onbeauthenticeerde
ingang naar de PDF-parser. Wil het kantoor die pagina toch openbaar maken, dan hoort
daar een aparte container bij — een publieke upload die door een parser gaat, hoort
niet in dezelfde container te staan als de ondertekengegevens:

```yaml
  validator:
    build: { context: ./sealer }
    environment:
      SEALER_SHARED_SECRET: ${SEALER_SHARED_SECRET}
      VALIDATOR_ONLY: 'true'    # weigert te starten met ondertekengegevens in de env
    mem_limit: 768m
    cpus: 1.0
    expose: ['8000']
```

en in `.env`: `SEALER_VALIDATE_URL="http://validator:8000"`. Zet in die service géén
`SEAL_*`- of `TSA_PASSWORD`-variabelen; het proces start dan niet.

## H. Beheer (onthouden voor later)

Voer deze commando's uit vanuit de map `/opt/signaturing`.

### Updaten naar een nieuwe versie

```bash
git pull
docker compose up -d --build
```

Database-migraties draaien automatisch mee bij het opstarten.

### Back-up maken (belangrijk!)

Twee dingen zijn onmisbaar: de database en de opgeslagen documenten.

```bash
# Database (maak een dumpbestand met datum)
docker compose exec -T db pg_dump -U ovp ovp_portaal > backup-db-$(date +%F).sql

# Documenten (versleutelde bestanden uit het volume)
docker run --rm -v signaturing_documents:/data -v $(pwd):/backup alpine \
  tar czf /backup/backup-documenten-$(date +%F).tar.gz -C /data .
```

Bewaar deze back-ups op een veilige, aparte plek (EU). Bewaar ook je `.env` (met
de sleutels) veilig: zonder `STORAGE_ENCRYPTION_KEY` zijn de documenten niet meer
te openen.

### Handige commando's

```bash
docker compose ps            # status van de services
docker compose logs -f web   # live logs van de app
docker compose restart web   # app herstarten
docker compose down          # alles stoppen (gegevens blijven bewaard)
docker compose up -d          # weer starten
```

---

## I. Eerst lokaal uitproberen (optioneel)

Wil je het eerst op je eigen computer testen zonder domein of echte e-mail?
Installeer Docker Desktop en draai in de map `signaturing`:

```bash
docker compose -f docker-compose.local.yml up -d --build
```

- Portaal: `http://localhost:3000`
- Verstuurde e-mails bekijk je op `http://localhost:8025` (Mailpit, nep-mailbox)

De geheimen zitten hier vast ingebouwd en zijn **alleen voor testen**, niet veilig
voor echt gebruik. Stoppen: `docker compose -f docker-compose.local.yml down`.

---

## J. Problemen oplossen

| Probleem                                   | Oorzaak / oplossing                                                                 |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| Geen HTTPS / certificaatfout               | DNS-record (deel B) wijst niet naar de server, of poort 80/443 dicht. Corrigeer en `docker compose restart caddy`. |
| E-mails komen niet aan                     | Controleer `SMTP_USER`/`SMTP_PASS`, zet Authenticated SMTP aan, stel SPF/DKIM/DMARC in. |
| E-mails belanden in spam                   | SPF/DKIM/DMARC ontbreken op het maildomein.                                         |
| `web` blijft herstarten                    | Bekijk `docker compose logs web`. Vaak een ontbrekend of te kort geheim in `.env` (min. 32 tekens). |
| "port is already allocated" bij starten    | Er draait al iets op poort 80/443. Stop dat, of pas de poorten aan.                 |
| Inloggen lukt niet de eerste keer          | Heb je `docker compose exec web npm run db:seed` gedraaid? (deel E1)                 |

---

## Kort overzicht van alle stappen

```bash
# A. Server
curl -fsSL https://get.docker.com | sh
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable

# B. DNS: A-record portaal -> server-IP  (in je DNS-beheer)

# C. Code
cd /opt && git clone https://github.com/x589h29ftn-code/signaturing.git && cd signaturing

# D. Config
cp .env.example .env
openssl rand -base64 48    # 5x uitvoeren, waarden in .env zetten
nano .env

# E. Starten
docker compose up -d --build
docker compose exec web npm run db:seed

# F. Open https://jouw-domein en log in
```
