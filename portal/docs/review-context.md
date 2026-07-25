# Ondertekenportaal OV&P — context voor review

**Versie:** 25 juli 2026
**Doel:** deze notitie in een Claude-chat plakken om de app te laten reviewen.
**Repo:** `signaturing` (branch `main`), gespiegeld uit `crispy-umbrella/portal`.

Alles hieronder is uit de code geverifieerd, niet uit het geheugen opgeschreven.
Waar iets bewust níet is gedaan, staat dat er ook bij — dat is meestal
interessanter dan de lijst met wat er wél is.

---

## 1. Wat het is

Zelf-gehost portaal waarmee een Nederlands accountantskantoor (Otto Visser &
Partners) documenten online laat ondertekenen. Cliënten hebben geen account: ze
komen binnen via een eenmalige link en een verificatiecode. Kantoormedewerkers
tekenen ingelogd; accountants kunnen daarnaast op persoonlijke titel
gekwalificeerd ondertekenen met een beroepscertificaat.

Vergelijkbaar met ValidSign / PKIsigning / Hix, maar in eigen beheer, met de data
op eigen infrastructuur.

## 2. Stack

- **Next.js 14.2** (App Router, Node-runtime), **React 18**, TypeScript, Tailwind 3.4
- **PostgreSQL 16 + Prisma 5.22** — 16 migraties
- **@cantoo/pdf-lib** (stempelen, auditpagina), **pdfjs-dist** (weergave/tekstextractie)
- **nodemailer** (SMTP) + Postmark/Resend via hun REST-API
- **@node-rs/argon2** (argon2id), **otpauth** (TOTP), **zod**, **rate-limiter-flexible**
- **LibreOffice headless** (Word→PDF), **tesseract** (OCR-terugval), **@e965/xlsx** (import)
- **Python-sidecar** met **pyHanko 0.25** voor PAdES-verzegeling
- Deploy: Docker Compose — `db`, `web`, `worker`, `sealer`, `caddy`

## 3. Datamodel

**Modellen:** Accountant, Session, Client, Dossier, Document, Recipient,
SignatureField, AuditEvent, CscSigningSession, MailEvent, Job, MessageTemplate.

**Enums:** Role, PartyRole, PartyStatus, FieldKind, DossierStatus, MailStatus,
VerificationMethod, SigningMode, DocumentKind.

Belangrijke velden:

- **Accountant** — passwordHash (argon2id), totpSecret (versleuteld),
  totpBackupCodes (gehasht), signaturePng. Beroepscertificaat:
  professionalTitle (AA/RA), nbaNumber, signingCertProvider,
  `signingCredentialId` (**uniek** — persoonsgebonden), signingCertEnabled,
  signingCertStatus, signingCertDisabledAt.
- **Client** — clientNumber, displayName, companyName, contactName, firstName,
  email, phone, kvk, adres, archiveFolder, verificationMethod, active.
  accessCodeHash/SetAt (schema-voorbereiding, geen UI).
- **Dossier** — status, ownerId, message, archiveFolder, sendCopyToRecipient,
  signingMode, linkTtlDays, expiresAt/sentAt/completedAt, `retentionUntil`.
- **Document** — originalKey, workingKey, `preSealKey`, sealedKey,
  documentSha256, `preSealSha256`, `sealedSha256`, sealedAt, `timestampedAt`,
  sealCertSerial, sealTsaUrl, detectedKind/detectedYear/ocrUsed.
- **Recipient** — role (ZELF|EXTERN), status, otpHash/Expires/Attempts/VerifiedAt,
  tokenHash (uniek)/Expires/UsedAt, `consentTextSnapshot`+hash+shownAt,
  `presentedHashes`+presentedAt, mailMessageId/mailStatus/mailBounceType/Reason/
  mailOpenedAt/mailResendCount.
- **AuditEvent** — append-only, type, ip, userAgent, metadata, `prevHash`, `hash`,
  `seq` (autoincrement).
- **DossierStatus** — CONCEPT, VERZONDEN, GEDEELTELIJK, ONDERTEKEND,
  `WACHT_OP_WAARMERK`, `SEALING_FAILED`, GEWEIGERD, VERLOPEN.

## 4. De ondertekenpipeline (volgorde is bewust strikt)

Zodra er een cryptografische handtekening in een PDF zit, mag het bestand niet
meer worden bewerkt. Vandaar deze volgorde:

1. Zichtbare handtekeningen/stempels plaatsen (pdf-lib).
2. Zichtbaar label "Digitaal ondertekend door: naam, datum/tijd".
3. Ondertekencertificaat als extra pagina erachter.
4. Plat slaan.
5. `preSealSha256` vastleggen; het artefact apart opslaan als `preSealKey`.
6. Eventueel de **gekwalificeerde handtekening** van de accountant.
7. Eventueel het **organisatiezegel** (incrementele update).
8. `sealedSha256` vastleggen. Vanaf hier read-only: archiveren en mailen.

Stap 5 als apart artefact bestaat zodat een mislukte verzegeling opnieuw kan
zonder de auditpagina een tweede keer toe te voegen.

**Fail-closed:** lukt het verzegelen niet, dan komt het dossier op
`SEALING_FAILED`, gaat er **geen** voltooiingsmail uit, en plant een job het
opnieuw in (1, 5, 15, 60 min, daarna elk uur). Na drie pogingen mail naar de
eigenaar; elke poging als `VERZEGELING_MISLUKT` in het auditspoor.

## 5. Verzegeling (sealer-sidecar)

Python/FastAPI + pyHanko, endpoints `/health`, `/seal`, `/prepare`, `/inject`,
`/validate`. **Niet publiek**: geen `ports:` in compose, geen Caddy-route, shared
secret in `X-Sealer-Secret`, body-limiet.

- PAdES-B-LT (of LTA) met tijdstempel en ingebedde OCSP/CRL.
- **Approval signature, geen DocMDP** — zodat een tweede handtekening als
  incrementele update geldig blijft.
- Driverkeuze via env: `csc` (Digidentity/Cleverbase) of `globalsign_dss`.
- De private sleutel staat altijd in een cloud-HSM bij de aanbieder; nooit een
  pfx/p12 op de server.

**Getest met een eigen testcertificaat** (volledige round-trip): placeholder →
hash over de **signedAttrs** → externe handtekening → injectie → handtekening
intact, geldig, dekt het hele document, en elke byte-wijziging wordt afgekeurd.

## 6. Gekwalificeerd ondertekenen (beroepscertificaat)

Twee soorten providers, met een wezenlijk verschil:

| Driver | Wie autoriseert | Gevolg |
|---|---|---|
| `digidentity` | de server (client-credentials) | automatisch |
| `cleverbase` | de **accountant** met pincode in de app | browserredirect nodig |

Bij Cleverbase komt een dossier op `WACHT_OP_WAARMERK` zodra alle partijen hebben
getekend. De accountant selecteert op `/te-ondertekenen/waarmerken` wat hij wil
ondertekenen en bevestigt **één keer** (tot 50 hashes onder één bevestiging).

- `CscSigningSession` overleeft de redirect: `state` van 32 random bytes,
  gecontroleerd op bestaan **en** eigenaarschap (anders IDOR), niet herbruikbaar
  na afronding, servicetoken versleuteld, opruimtaak voor verlopen sessies.
- Encodings: **base64url komma-gescheiden** in `/oauth2/authorize`, **gewone
  base64** in `signHash`.
- Batch is **atomair**: mislukt er één, dan wordt er niets geïnjecteerd.
- **Intrekking afgedwongen**: status ≠ `enabled` → certificaat uit, auditregel,
  mail naar beheerders. Bij elke sessie gecontroleerd.
- Harde guard: het portaal **weigert te starten** met de openbare Cleverbase-stub
  in productie (op env-vlag én op het bekende client-id).

## 7. Beveiliging

- **Transport:** TLS via Caddy, HSTS, HttpOnly/Secure/SameSite-cookies, CSP met
  nonce, security headers in middleware.
- **At rest:** documenten AES-256-GCM met envelope-encryptie (unieke DEK + IV,
  GCM-tag). TOTP-secrets kolom-versleuteld. Wachtwoorden argon2id; OTP's en
  tekentokens alleen als hash.
- **Sleutelrotatie:** de sleutelversie staat **in de data zelf** (blob-header /
  `v<N>:`-prefix), niet in een kolom. Ontsleutelen met de versie uit de data,
  versleutelen met de huidige. Oude data blijft leesbaar; ontbrekende sleutel
  geeft een expliciete melding met versienummer.
- **Toegang:** TOTP-2FA + backupcodes, progressieve login-lockout (5→5min,
  8→30min, 12→2u), gehard tegen timing-enumeratie, intrekbare DB-sessies,
  rollen met server-side autorisatie, geen IDOR (cuid + eigenaarscontrole).
- **Ondertekenaars:** eenmalige, kortlevende, gehashte tekentoken + e-mail/sms-OTP.
  Mislukte en geblokkeerde codes als eigen auditregels.
- **Uploads:** MIME/grootte-check, optionele ClamAV-scan (**fail-closed**),
  LibreOffice gesandboxed zonder netwerk, downloads met attachment + nosniff.
- **IP:** rechts-uit-X-Forwarded-For met instelbaar `TRUSTED_PROXY_HOPS`.
- **Integriteit bij download:** `sealedSha256` opnieuw berekend; afwijking
  blokkeert de download en levert `INTEGRITEIT_AFWIJKING`.

## 8. Auditspoor

30 typen (AANGEMAAKT, VERZONDEN, GEOPEND, OTP_*, ONDERTEKEND,
GEKWALIFICEERD_ONDERTEKEND, CSC_*, CERTIFICAAT_INGETROKKEN, MAIL_*, VERZEGELD,
VERZEGELING_MISLUKT, INTEGRITEIT_AFWIJKING, GEDOWNLOAD, GEARCHIVEERD, …).

- **Append-only in techniek:** een databasetrigger weigert UPDATE en DELETE, met
  één noodschakelaar (`app.audit_purge`) die alleen de geplande opruiming binnen
  één transactie gebruikt.
- **Hashketen per dossier**, niet globaal. Bewust: de bewaartermijn ruimt een
  compleet dossier op, en bij één globale keten zou zo'n legitieme opruiming de
  keten van alle andere dossiers breken — een keten die altijd "gebroken" is
  beschermt niets. Regels zonder dossier vormen één eigen keten.
- Metadata wordt **gecanonicaliseerd** (sleutels gesorteerd) omdat Postgres JSONB
  de sleutelvolgorde niet bewaart.
- **Wat het aantoont:** elke wijziging, en verwijdering middenin een dossier.
  **Wat het niet aantoont:** verwijdering van de oudste regels van een dossier —
  daarvoor is een anker buiten de database nodig. Dat staat zo in de code.
- Op het ondertekencertificaat: naam, e-mail, IP, user-agent, OTP-tijd,
  ondertekentijd, de **letterlijke instemmingstekst** die de ondertekenaar zag, de
  **hash van de bytes die die persoon te zien kreeg**, en het onderscheid tussen
  serverklok en tijdstempeldienst.

## 9. E-mail

`MAIL_TRANSPORT` = smtp | postmark | resend. Bij de laatste twee komt het
message-id terug en wordt de bezorgstatus verwerkt op `/api/webhooks/mail`.

- Verificatie: basicauth + optionele IP-lijst (Postmark), Svix-signatuur met
  tijdvenster van 5 min (Resend). **Zonder instellingen wordt alles geweigerd.**
- Idempotent op `providerEventId`.
- Bounces: hard = definitief + mail naar eigenaar + herinneren geblokkeerd;
  tijdelijk = één herzending na een uur, daarna als hard. Een "tijdelijke" bounce
  op een uitgezet adres geldt direct als hard.
- **Openen** wordt gelogd als procesindicatie maar staat bewust **niet** op het
  ondertekencertificaat (geblokkeerde afbeeldingen missen een opening;
  vooraf-ophalende privacybescherming meldt er een die niet plaatsvond).

## 10. Overige onderdelen

- **Documentherkenning** (`docanalyze`): tekstlaag → trefwoorden → boekjaar-regex
  → sjabloonsuggestie. Types: JAARREKENING, NOTULEN_AVA,
  BEVESTIGING_JAARREKENING, AKKOORD_IB, AKKOORD_VPB, OPDRACHTBEVESTIGING, OVERIG.
  Jaarrekening + notulen + bevestiging worden desgewenst één verzoek.
- **Archief**: driver `none` | `folder` | `sharepoint` (Graph). Mapstructuur per
  klant (`<klantnummer> - <naam>`) + boekjaar, per dossier overschrijfbaar.
  Verzegelde bytes worden **verbatim** gekopieerd.
- **Job queue** op Postgres (`FOR UPDATE SKIP LOCKED`): SEAL_RETRY, MAIL_RESEND,
  CSC_SESSION_CLEANUP, RETENTION_CLEANUP. Terugkerende taken plannen zichzelf.
  REMINDER/EXPIRE/ARCHIVE staan in de enum maar hebben nog geen handler.
- **Bewaartermijn**: 7 jaar na afronding; document en bewijsspoor verdwijnen
  altijd samen in één transactie. Droogloop is de standaard.
- **Back-up**: `scripts/backup.sh` (versleuteld met age/gpg, weigert zonder
  ontvanger) en `scripts/restore-test.sh` + `verify-restore.ts`, die een
  terugzetting in een weggooi-omgeving controleert tot en met "valideert een
  verzegeld document nog".
- **Cliënten**: lijst met kolom **klantnummer**, gesorteerd op klantnummer
  (zonder nummer achteraan), zoeken op klantnummer, naam, bedrijfsnaam,
  contactpersoon en e-mail. Excel/CSV-import met upsert op e-mail.
- **Publieke controlepagina** `/valideren`: PDF uploaden, zien of het zegel geldig
  is; het bestand wordt niet opgeslagen.

## 11. Routes

**Pagina's (ingelogd):** /dashboard · /dossiers/nieuw · /dossiers/[id] ·
/dossiers/[id]/voorbereiden · /klanten(+/[id], /nieuw, /importeren) ·
/te-ondertekenen(+/[id], /waarmerken) · /instellingen(+/gebruikers, /sjablonen)

**Publiek:** /login(+/2fa) · /teken/[token] · /valideren · /wachtwoord-vergeten ·
/wachtwoord-herstellen/[token]

**API:** /api/clients · /api/accountants · /api/dossiers/[id]/(download|pdf) ·
/api/sign/[token]/(otp|verify|submit|decline|pdf) · /api/csc/callback ·
/api/webhooks/mail

## 12. Bewust niet gedaan

Belangrijk voor een review: dit is geen vergeetlijst maar een reeks keuzes.

1. **Geen aparte toegangscode als tweede kanaal.** De tweede factor gaat naar
   hetzelfde e-mailadres als de link. De koppeling tussen handtekening en persoon
   rust dus op de mailbox van de ondertekenaar. Dat is een reële beperking; de
   schemavelden staan klaar (`accessCodeHash`), zonder UI of handhaving.
2. **Geen Visionplanner/AFAS/Exact-koppeling.** Documenten komen via upload binnen.
3. **Geen aparte `SEALED`-status.** `ONDERTEKEND` blijft de eindstatus; het
   onderscheid zit in `sealedSha256`/`timestampedAt` per document. Een extra
   status zou "klaar" over twee waarden splitsen en het dashboardfilter breken.
4. **Rate limiting in het geheugen**, niet in Postgres. Klopt bij één
   webcontainer; bij meerdere gelden de limieten per container. Gedocumenteerd als
   voorwaarde in `docs/beheer.md`.
5. **Geen PAdES-LTA-archivering na jaren** (alleen de LTA-parameter). Bij een
   bewaartermijn van 7 jaar is periodiek hervernieuwen van tijdstempels iets om
   nog te bekijken.
6. **In de UI geen juridische kwalificaties.** Er staat "digitaal ondertekend" en
   "verzegeld", niet "gekwalificeerd" of "AES/eIDAS-niveau X" — behalve bij een
   echte beroepscertificaat-handtekening. Bewust geen overclaim.

## 13. Wat nog niet in productie is bewezen

Eerlijk over de grenzen van wat er getest is:

- **Verzegeling staat standaard uit** (`SEAL_MODE=none`); er is nog geen
  organisatiecertificaat en geen TSA-URL gekozen.
- **De CSC-netwerkaanroepen zijn niet tegen een echte provider getest** — de
  ontwikkelomgeving mag Cleverbase niet bereiken. `npm run csc:check` zoekt twee
  punten uit waarover hun documentatie niet eenduidig is: gaat de `service`-scope
  via client_credentials, en hoe ziet een verlopen SAD eruit.
- **De PDF-kant van het tweefasige ondertekenen is wél end-to-end bewezen**, met
  een zelfgemaakt testcertificaat.
- **Mailprovider nog niet gekozen**; SMTP werkt, de webhook-verwerking is getest
  met nagemaakte payloads van beide providers.
- **Geen geautomatiseerde testsuite.** Er is geen vitest/playwright-opzet;
  verificatie ging met wegwerpscripts tegen een echte Postgres (per onderwerp
  9–30 controles). Dat is een reëel gat: er is geen regressienet in CI.

## 14. Waar een review het meest oplevert

Suggesties, geen beperking:

1. **De pipeline-volgorde en de idempotentie** in `src/lib/signflow.ts` — kan een
   dossier vast blijven zitten, of twee keer verzegeld worden?
2. **De CSC-flow** in `src/lib/csc/` — state/eigenaarschap, atomaire batch,
   foutclassificatie (welke fout mag opnieuw?).
3. **De hashketen per dossier** in `src/lib/audit.ts` — is de gekozen grens juist,
   en klopt de bewering over wat het wél/niet aantoont?
4. **Sleutelrotatie** in `src/lib/storage/` — kan data onleesbaar raken?
5. **Het ontbrekende regressienet** — wat zou een minimale, waardevolle testsuite
   zijn voor juist deze app?
6. **Het niveau-vraagstuk uit punt 12.1** — is de tweede factor via hetzelfde
   kanaal verdedigbaar voor samenstelverklaringen en akkoordbrieven, of is de
   toegangscode nodig?

## 15. Documentatie in de repo

`docs/verzegeling.md` (verzegeling, tijdstempel, beroepscertificaat, mail),
`docs/beheer.md` (back-up, bewaartermijn, sleutelrotatie, achtergrondtaken),
`docs/hosting-handleiding.md`, `docs/handleiding/` (gebruikershandleiding v3.0,
28 pagina's, met schermafbeeldingen).
