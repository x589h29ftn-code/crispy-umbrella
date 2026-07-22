# Ondertekenportaal — Otto Visser & Partners

Een zelf-gehost online portaal om documenten (PDF of Word) te importeren, een
eigen handtekening te plaatsen, een tekenveld voor de ontvanger toe te voegen en
het document per e-mail aan te bieden. De ontvanger tekent **in de browser** —
geen software nodig. Met dashboard per accountant, herinneringen,
tweefactorauthenticatie, een cliëntendatabase en een verzegelde eind-PDF met
auditcertificaat.

Dit portaal is een **aparte webapplicatie** binnen dezelfde repository als de
desktop-app "PDF Studio"; de desktop-app blijft ongewijzigd.

## Techniek

- **Next.js 14** (App Router, Node-runtime) — één deploybare web + API
- **PostgreSQL + Prisma**
- Eigen **sessie-authenticatie** (argon2id) met **TOTP-2FA**, intrekbare DB-sessies
- **nodemailer** (standaard Microsoft 365 SMTP; omschakelbaar naar Postmark/Resend)
- **@cantoo/pdf-lib** (stempelen/verzegelen) + **pdf.js** (weergave in de browser)
- **LibreOffice headless** in de container voor Word→PDF
- Documenten **AES-256-GCM** versleuteld op een volume
- **Tailwind CSS** voor een strakke, moderne uitstraling

## Kernstroom

1. Accountant logt in (wachtwoord + TOTP), importeert een PDF/Word-document.
2. Plaatst tekenvelden op de pagina's en koppelt ontvangers uit de cliëntendatabase.
3. Verstuurt: elke ontvanger krijgt een e-mail met een unieke, kortlevende link.
4. Ontvanger opent de link, verifieert zich met een **e-mailcode** (2e factor) en
   tekent in de browser (tekenen of typen).
5. Zodra iedereen getekend heeft, wordt de PDF **verzegeld** met een SHA-256-hash
   en een auditcertificaat, en per e-mail rondgestuurd.
6. Het dashboard toont per accountant de status en biedt herinneringen.

## Lokaal ontwikkelen

Vereist: Node 20+, een PostgreSQL-database, en (voor Word→PDF) LibreOffice.

```bash
cp .env.example .env          # vul de geheimen in (openssl rand -base64 48)
npm install
npm run db:deploy             # voert de migraties uit
npm run db:seed               # maakt een beheerder + voorbeeldcliënten
npm run dev                   # http://localhost:3000
```

Tip: gebruik in dev een lokale mailcatcher (bijv. Mailpit) en zet `SMTP_HOST`
daarnaar toe om verzoek-, OTP- en voltooiingsmails te inspecteren.

## Zelf hosten (Docker, EU-server)

```bash
cp .env.example .env          # vul ALLE geheimen + POSTGRES_* + PORTAL_DOMAIN in
docker compose up -d --build
```

- `caddy` regelt automatisch HTTPS (Let's Encrypt) voor `PORTAL_DOMAIN`.
- Migraties draaien automatisch bij het opstarten van de `web`-container.
- Maak de eerste beheerder aan:
  ```bash
  docker compose exec web node_modules/.bin/tsx prisma/seed.ts
  ```
- Documenten staan versleuteld in het `documents`-volume; de database in `pgdata`.
  Maak hiervan **versleutelde back-ups** (in de EU) en draai de VPS bij voorkeur
  met volledige schijfversleuteling.

### Verplichte geheimen (`.env`)

| Variabele | Doel |
|---|---|
| `SESSION_SECRET` | Ondertekent sessiecookies (HMAC) |
| `SIGNING_TOKEN_SECRET` | Ondertekent teken-tokens + OTP-hashes |
| `STORAGE_ENCRYPTION_KEY` | AES-256-GCM op opgeslagen documenten |
| `TOTP_ENCRYPTION_KEY` | Versleutelt TOTP-secrets in de database |
| `POSTGRES_PASSWORD` | Databasewachtwoord |
| `PORTAL_DOMAIN` | Domein voor HTTPS |
| `SMTP_*` / `MAIL_FROM` | E-mailverzending (Microsoft 365) |

> Microsoft 365 vereist mogelijk een **app-wachtwoord** of ingeschakelde
> "Authenticated SMTP". Voor de beste afleverbaarheid kan later worden
> overgeschakeld naar Postmark/Resend via `MAIL_TRANSPORT`.

## Beveiliging in het kort

Versleuteling onderweg (TLS/HSTS) en in rust (AES-256-GCM + schijfversleuteling);
argon2id-wachtwoorden; verplichte TOTP-2FA voor medewerkers; eenmalige, gehashte
teken-tokens + e-mail-OTP voor ondertekenaars; rate-limiting; strikte CSP en
security-headers; append-only auditspoor; SHA-256-verzegeling van de eind-PDF.
Zie het projectplan voor de volledige beschrijving (9 lagen "defense in depth").

## Wat hierna komt (fase 2/3)

Volgordelijk tekenen, automatische herinneringen/vervaltermijn, TOTP-backupcodes,
gebruikersbeheer, S3-opslag, AVG-bewaartermijn, en optioneel een cryptografische
PAdES/PKCS#7-verzegeling.
