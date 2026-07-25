# Ondertekenportaal OV&P — blauwdruk en terugkoppeling

**Versie:** 2 — 25 juli 2026, na changeset v1.2
**Doel:** deze notitie in een Claude-chat plakken om de app te laten reviewen.
**Repo:** `signaturing` (branch `main`), gespiegeld uit `crispy-umbrella/portal`.
**Vorige ronden:** opdracht v1.0 · wijzigingen v1.1 · changeset v1.2 (hieronder afgehandeld)

Alles hieronder is uit de code geverifieerd, niet uit het geheugen opgeschreven.
Waar iets bewust níet is gedaan, staat de reden erbij — dat is meestal
interessanter dan de lijst met wat er wél is.

**Leeswijzer.** Deel A is de blauwdruk: hoe de app in elkaar zit. Deel B is de
terugkoppeling op changeset v1.2, per punt met de reden waarom het wel of niet is
gedaan. Deel C is wat er nog open staat en waar een volgende review het meest
oplevert.

---

# Deel A — Blauwdruk

## A1. Wat het is

Zelf-gehost portaal waarmee een Nederlands accountantskantoor (Otto Visser &
Partners) documenten online laat ondertekenen. Cliënten hebben geen account: ze
komen binnen via een eenmalige link en een verificatiecode. Kantoormedewerkers
tekenen ingelogd; accountants kunnen daarnaast op persoonlijke titel
gekwalificeerd ondertekenen met een beroepscertificaat.

Vergelijkbaar met ValidSign / PKIsigning / Hix, maar in eigen beheer, met de data
op eigen infrastructuur.

## A2. Architectuur in vijf containers

```
                    internet
                        │
                     :443 (TLS, HSTS, Let's Encrypt)
                        │
                  ┌─────▼─────┐
                  │   caddy   │  reverse proxy, enige publieke poort
                  └─────┬─────┘
                        │
         ┌──────────────▼──────────────┐
         │            web              │  Next.js 14 (App Router, Node-runtime)
         │  pagina's + API + pdf-lib   │  LibreOffice, tesseract, ClamAV-client
         └───┬────────────┬────────┬───┘
             │            │        │
             │            │        └──────────► SMTP / Postmark / Resend
             │            │                     (uitgaand, mail + webhooks terug)
             │            │
             │      ┌─────▼──────┐
             │      │   sealer   │  Python + pyHanko
             │      │  PAdES-B-LT│  GEEN ports:, GEEN Caddy-route
             │      └─────┬──────┘  shared secret in X-Sealer-Secret
             │            │
             │            └──────────► TSA (tijdstempel) + signing-provider (HSM)
             │
       ┌─────▼─────┐        ┌──────────┐
       │    db     │◄───────│  worker  │  job queue, FOR UPDATE SKIP LOCKED
       │ Postgres16│        └──────────┘
       └───────────┘
             ▲
             └── volume `documents` (AES-256-GCM per bestand) + volume `pgdata`
```

Waarom deze verdeling:

- **`sealer` apart.** pyHanko is Python en heeft de LT-laag (revocatiegegevens in
  de DSS-dictionary, document-timestamp, correcte incrementele updates) ingebouwd.
  In pdf-lib is dat handwerk en foutgevoelig. Bijkomend voordeel: de container met
  toegang tot de ondertekencredentials is niet publiek bereikbaar.
- **`worker` apart.** Een verzegeling die faalt moet opnieuw kunnen zonder dat er
  een HTTP-request open staat. Eén worker-instance; de queue kan meer aan, de
  volgorde-garanties zijn daar niet op ontworpen.
- **`db` niet publiek.** Alleen het interne Docker-netwerk.

## A3. Stack

- **Next.js 14.2** (App Router, Node-runtime), **React 18**, TypeScript, Tailwind 3.4
- **PostgreSQL 16 + Prisma 5.22** — 17 migraties
- **@cantoo/pdf-lib** (stempelen, auditpagina), **pdfjs-dist** (weergave/tekstextractie)
- **nodemailer** (SMTP) + Postmark/Resend via hun REST-API
- **@node-rs/argon2** (argon2id), **otpauth** (TOTP), **zod**, **rate-limiter-flexible**
- **LibreOffice headless** (Word→PDF), **tesseract** (OCR-terugval), **@e965/xlsx** (import)
- **Python-sidecar** met **pyHanko 0.25.3** voor PAdES-verzegeling
- Deploy: Docker Compose — `db`, `web`, `worker`, `sealer`, `caddy`

## A4. Datamodel

**12 modellen:** Accountant, Session, Client, Dossier, Document, Recipient,
SignatureField, AuditEvent, CscSigningSession, MailEvent, Job, MessageTemplate.

**10 enums:** Role, PartyRole, PartyStatus, FieldKind, DossierStatus,
**SealStage**, MailStatus, VerificationMethod, SigningMode, DocumentKind.

Belangrijke velden:

- **Accountant** — passwordHash (argon2id), totpSecret (versleuteld),
  totpBackupCodes (gehasht), signaturePng. Beroepscertificaat:
  professionalTitle (AA/RA), nbaNumber, signingCertProvider,
  `signingCredentialId` (**uniek** — persoonsgebonden), signingCertEnabled,
  signingCertStatus, signingCertDisabledAt.
- **Client** — clientNumber, displayName, companyName, contactName, firstName,
  email, phone, kvk, adres, archiveFolder, verificationMethod, active.
  accessCodeHash/SetAt (schema-voorbereiding, geen UI).
- **Dossier** — status, ownerId, message, archiveFolder, sendCopyToRecipient
  (standaard **aan**), signingMode, linkTtlDays, expiresAt/sentAt/completedAt,
  `retentionUntil`.
- **Document** — originalKey, workingKey, `preSealKey`, `postQualifiedKey`,
  sealedKey, documentSha256, `preSealSha256`, `postQualifiedSha256`,
  `sealedSha256`, **`sealStage`**, sealedAt, `timestampedAt`, sealCertSerial,
  sealTsaUrl, detectedKind/detectedYear/ocrUsed.
- **Recipient** — role (ZELF|EXTERN), status, otpHash/Expires/Attempts/VerifiedAt,
  tokenHash (uniek)/Expires/UsedAt, `consentTextSnapshot`+hash+shownAt,
  `presentedHashes`+presentedAt, mailMessageId/mailStatus/mailBounceType/Reason/
  mailOpenedAt/mailResendCount.
- **AuditEvent** — append-only, type, ip, userAgent, metadata, `prevHash`, `hash`,
  `seq` (autoincrement, uniek).
- **CscSigningSession** — state (32 random bytes), credentialId, documentIds,
  preparedKeys, hashes, serviceToken (versleuteld), **`signatureValues`**
  (versleuteld, tijdelijk), **`sentHashes`**, status, expiresAt.
- **DossierStatus** — CONCEPT, VERZONDEN, GEDEELTELIJK, ONDERTEKEND,
  WACHT_OP_WAARMERK, SEALING_FAILED, GEWEIGERD, VERLOPEN.
- **SealStage** — NONE, PRESEAL, QUALIFIED, SEALED. Expliciet, niet afgeleid uit
  het gevuld zijn van sleutels; zie B3.

## A5. De ondertekenpipeline (volgorde is bewust strikt)

Zodra er een cryptografische handtekening in een PDF zit, mag het bestand niet
meer worden bewerkt. Vandaar deze volgorde, met drie herstartpunten:

```
 CONCEPT ──► VERZONDEN ──► GEDEELTELIJK ──► (alle partijen klaar)
                                                    │
   1. zichtbare handtekeningen stempelen (pdf-lib)   │  ← binnen FOR UPDATE
   2. label "Digitaal ondertekend door: naam, tijd"  │     per document
   3. ondertekencertificaat als extra pagina         │
   4. plat slaan                                     ▼
   5. preSealSha256 + preSealKey ─────────── herstartpunt 1  sealStage=PRESEAL
                                                    │
   6. gekwalificeerde handtekening (accountant)      │  ← pincode van een mens
      postQualifiedKey ──────────────────── herstartpunt 2  sealStage=QUALIFIED
                                                    │
   7. organisatiezegel (incrementele update)         │  ← job, herhaalbaar
      sealedKey ─────────────────────────── herstartpunt 3  sealStage=SEALED
                                                    ▼
   8. read-only: archiveren, mailen, downloaden          ONDERTEKEND
```

Waarom drie herstartpunten en niet één: stap 6 kost een mens een pincode, stap 7
is een machine die het opnieuw kan. Zonder herstartpunt 2 zou een mislukte TSA in
stap 7 de retry terugzetten naar vóór stap 6, en bij een batch van vijftig stukken
vijftig keer opnieuw een pincode kosten.

**Fail-closed:** lukt het verzegelen niet, dan komt het dossier op
`SEALING_FAILED`, gaat er **geen** voltooiingsmail uit, en plant een job het
opnieuw in (1, 5, 15, 60 min, daarna elk uur, maximaal 12 pogingen). Na drie
pogingen mail naar de eigenaar; elke poging als `VERZEGELING_MISLUKT` in het
auditspoor. Een definitieve fout (pyHanko geeft 400) stopt direct met een melding
in plaats van eeuwig rond te draaien.

## A6. Verzegeling (sealer-sidecar)

Python/FastAPI + pyHanko, endpoints `/health`, `/seal`, `/prepare`, `/inject`,
`/validate`. **Niet publiek**: geen `ports:` in compose, geen Caddy-route, shared
secret in `X-Sealer-Secret`, body-limiet.

- PAdES-B-LT (of LTA) met tijdstempel en ingebedde OCSP/CRL.
- **Approval signature, geen DocMDP** — zodat een tweede handtekening als
  incrementele update geldig blijft.
- **Idempotent op veldnaam:** staat er al een handtekening in `OfficeSeal`, dan
  geeft `/seal` een `409` met serienummer en tijdstip en tekent hij niet. De
  webkant behandelt dat als succes en werkt alleen de database bij.
- Driverkeuze via env: `csc` (Digidentity/Cleverbase) of `globalsign_dss`.
- De private sleutel staat altijd in een cloud-HSM bij de aanbieder; nooit een
  pfx/p12 op de server.
- `/validate` scheidt twee vragen: **is het bestand ongewijzigd** (rekenwerk aan
  het document zelf, geen netwerk) en **is de uitgever te vertrouwen** (keten +
  revocatie). Zie B5 waarom die scheiding er is.

**Getest met een eigen testcertificaat** (volledige round-trip): placeholder →
hash over de **signedAttrs** → externe handtekening → injectie → handtekening
intact, geldig, dekt het hele document, en elke byte-wijziging wordt afgekeurd.

## A7. Gekwalificeerd ondertekenen (beroepscertificaat)

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
- **Invariant vóór injectie:** de opnieuw berekende hashes moeten byte-gelijk zijn
  aan wat er naar de autorisatie is gestuurd (`sentHashes`). Niet gelijk →
  `CSC_HASH_MISMATCH`, sessie `FAILED`, geen retry. Dat is een programmeerfout en
  geen storing; een retry zou hem maskeren.
- **Handtekeningwaarden versleuteld vastgelegd** vóór injectie en direct daarna
  gewist, zodat een crash halverwege een batch geen nieuwe pincode kost.
- Batch is **atomair**: mislukt er één, dan wordt er niets geïnjecteerd.
- **Intrekking afgedwongen**: status ≠ `enabled` → certificaat uit, auditregel,
  mail naar beheerders. Bij elke sessie gecontroleerd.
- Harde guard: het portaal **weigert te starten** met de openbare Cleverbase-stub
  in productie (op env-vlag én op het bekende client-id, met witruimte eraf).

## A8. Beveiliging

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
- **Publieke controlepagina:** `allow_fetching=False`, dus de geüploade PDF kan de
  server niet naar interne adressen laten bellen (SSRF).
- **IP:** rechts-uit-X-Forwarded-For met instelbaar `TRUSTED_PROXY_HOPS`.
- **Integriteit bij download:** `sealedSha256` opnieuw berekend; afwijking
  blokkeert de download en levert `INTEGRITEIT_AFWIJKING`.
- **Opstartregels:** het portaal weigert te starten met de Cleverbase-teststub in
  productie, en met `SEAL_MODE=none` in productie tenzij ook `ALLOW_UNSEALED=true`
  is gezet. Eén vlag zet iemand per ongeluk, twee niet.

## A9. Auditspoor

32 typen (AANGEMAAKT, VERZONDEN, GEOPEND, OTP_*, TOEGANGSCODE_*, ONDERTEKEND,
GEKWALIFICEERD_ONDERTEKEND, CSC_*, CERTIFICAAT_INGETROKKEN, MAIL_*, VERZEGELD,
VERZEGELING_MISLUKT, VERZEGELING_OVERGESLAGEN, BEWAARTERMIJN_OPGERUIMD,
INTEGRITEIT_AFWIJKING, GEDOWNLOAD, GEARCHIVEERD, INGELOGD, …).

- **Append-only in techniek:** een databasetrigger weigert UPDATE en DELETE, met
  één noodschakelaar (`app.audit_purge`) die alleen de geplande opruiming binnen
  één transactie gebruikt.
- **Hashketen per dossier**, niet globaal. Bewust: de bewaartermijn ruimt een
  compleet dossier op, en bij één globale keten zou zo'n legitieme opruiming de
  keten van alle andere dossiers breken — een keten die altijd "gebroken" is
  beschermt niets. Regels zonder dossier vormen één eigen keten.
- **Eén schrijver per keten** via een advisory lock. Zonder die vergrendeling
  lezen twee gelijktijdige schrijvers dezelfde laatste regel en vorkt de keten
  onherstelbaar; zie B1.
- Metadata wordt **gecanonicaliseerd** (sleutels gesorteerd) omdat Postgres JSONB
  de sleutelvolgorde niet bewaart.
- **Wat het aantoont:** elke wijziging van een regel, verwijdering middenin een
  keten, en het afknippen van de kop van een keten (de eerste regel verwijst dan
  naar een voorganger die niet meer bestaat).
  **Wat het niet aantoont:** het verwijderen van een compleet dossier mét zijn
  hele keten. Daarvoor is een anker buiten de database nodig. De geplande
  opruiming laat wel een grafsteen achter met het aantal regels en de laatste hash.
  **Waar de grens ligt:** dit beschermt tegen applicatiefouten en tegen
  databasetoegang zónder applicatietoegang, niet tegen een mens met volledige
  databaserechten — die kan de noodschakelaar zelf zetten.
- Op het ondertekencertificaat: naam, e-mail, IP, user-agent, OTP-tijd,
  ondertekentijd, de **letterlijke instemmingstekst** die de ondertekenaar zag, de
  **hash van de bytes die die persoon te zien kreeg** (met de uitleg dat die per
  persoon verschilt en niet gelijk is aan het eindbestand), en het onderscheid
  tussen serverklok en tijdstempeldienst. Staat de verzegeling uit, dan staat er
  **"Dit document is niet verzegeld."** — niet onderdrukbaar.

## A10. E-mail

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

## A11. Overige onderdelen

- **Documentherkenning** (`docanalyze`): tekstlaag → trefwoorden → boekjaar-regex
  → sjabloonsuggestie. Types: JAARREKENING, NOTULEN_AVA,
  BEVESTIGING_JAARREKENING, AKKOORD_IB, AKKOORD_VPB, OPDRACHTBEVESTIGING, OVERIG.
  Jaarrekening + notulen + bevestiging worden desgewenst één verzoek.
- **Archief**: driver `none` | `folder` | `sharepoint` (Graph). Mapstructuur per
  klant (`<klantnummer> - <naam>`) + boekjaar, per dossier overschrijfbaar.
  Verzegelde bytes worden **verbatim** gekopieerd.
- **Job queue** op Postgres (`FOR UPDATE SKIP LOCKED`): SEAL_RETRY, MAIL_RESEND,
  CSC_SESSION_CLEANUP, RETENTION_CLEANUP. Terugkerende taken plannen zichzelf.
  REMINDER/EXPIRE/ARCHIVE staan in de enum maar hebben nog geen handler; zie B8.
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
- **Regressiescripts** (`npm run test:regressie`, 42 controles) plus een
  sealertest met een zelfondertekend testcertificaat (14 controles). Zie B10.

## A12. Routes

**Pagina's (ingelogd):** /dashboard · /dossiers/nieuw · /dossiers/[id] ·
/dossiers/[id]/voorbereiden · /klanten(+/[id], /nieuw, /importeren) ·
/te-ondertekenen(+/[id], /waarmerken) · /instellingen(+/gebruikers, /sjablonen)

**Publiek:** /login(+/2fa) · /teken/[token] · /valideren · /wachtwoord-vergeten ·
/wachtwoord-herstellen/[token]

**API:** /api/clients · /api/accountants · /api/dossiers/[id]/(download|pdf) ·
/api/sign/[token]/(otp|verify|submit|decline|pdf) · /api/csc/callback ·
/api/webhooks/mail

---

# Deel B — Terugkoppeling op changeset v1.2

De changeset vroeg om "verifieer, dan repareer" in plaats van "bouw dit". Dat is
gedaan: eerst elk punt tegen de code gelegd, dan pas gewijzigd. Vier van de
genoemde punten waren echt kapot, zeven waren al klaar, en er kwamen twee
defecten bij die niet in de changeset stonden.

## B1. Race op `workingKey` — was aanwezig, gerepareerd

**Bevonden:** het stempelen gebeurde inderdaad in de submit-handler, niet in de
finalisatiepipeline. De aanname in de changeset dat stap 1 pas na alle partijen
liep, was onjuist.

**Gekozen oplossing, en waarom een andere dan geadviseerd.** De changeset stelde
voor om per ontvanger alleen de artefacten te bewaren en alles in één keer te
stempelen in de finalisatie. Dat is een schonere architectuur, maar het raakt de
submit-handler, de finalisatie, het datamodel (artefacten per ontvanger) en de
tekenpagina. In plaats daarvan zit nu de **hele lees-bewerk-schrijf binnen
`SELECT … FOR UPDATE` per document**, in een vaste volgorde op `documentId`.
Gelijktijdige indieningen wachten netjes op elkaar en elke stempel komt op het
resultaat van de vorige.

Dat geeft dezelfde garantie met veel minder oppervlak. Wat het níet geeft is
bit-voor-bit reproduceerbaarheid van de stempelvolgorde over `Recipient.order` —
de volgorde is nu "wie het eerst indient". Voor het bewijs maakt dat niets uit
(elke ondertekenaar heeft zijn eigen `presentedHashes`), voor een golden-file-test
straks wel. Als dat gaat storen is de verplaatsing naar de finalisatie alsnog te
doen.

**Aangetoond dat de test hem vangt.** Met de vergrendeling er tijdelijk uit
verdwijnt de handtekening van de eerste ondertekenaar: één stempel in het bestand,
twee `filled` velden in de database — exact het stille dataverlies uit de
changeset. Met de vergrendeling erin blijven beide staan.

## B2. Dezelfde race in het auditspoor — niet in de changeset, wel echt

Bij het draaien van de concurrency-test bleek de hashketen te vorken. Twee
gelijktijdige `writeAudit`-aanroepen lazen dezelfde laatste regel en verwezen
beide nieuwe regels naar dezelfde `prevHash`.

Dat is erger dan het lijkt: het is **niet te herstellen** (de regels zijn
append-only) en de verifier meldt daarna voor altijd een breuk die niemand heeft
veroorzaakt. Een controle die altijd rood staat wordt genegeerd, en dan beschermt
de hele keten niets meer — precies het argument dat de changeset zelf gebruikt bij
de globale versus per-dossier keten.

Opgelost met een **advisory lock per keten** rond het lezen-en-schrijven. Ook hier
bewezen dat de test hem vangt.

Bijvangst: bij het bouwen bleek dat `writeAudit` bewust stil faalt (het auditspoor
mag de flow niet blokkeren). Toen de lock-query even een typefout had, werden er
geen regels geschreven — en de test meldde "keten intact", want een lege keten is
ook intact. De regressietest controleert nu eerst of er überhaupt is geschreven.

## B3. Idempotentie op veldnaam — gebouwd zoals geadviseerd

De changeset trok het eerdere advies ("`sealedKey` bestaat al → doe niets") in en
had daarin gelijk: de dual write tussen blob en databaserij is een echt gat, en
met meerdere workers geen theorie.

`/seal` inspecteert nu de inkomende PDF op een handtekening in het gevraagde veld
en geeft bij aanwezigheid `409` met serienummer en tijdstip. De webkant heeft een
`AlreadySealedError` die als succes geldt en alleen de database bijwerkt.

Wat ik **niet** heb gedaan: de veldnaam per accountant (`Professional_<nbaNumber>`).
Reden: de gekwalificeerde handtekening loopt via `/prepare` + `/inject` en niet via
`/seal`, en daar zit de idempotentie al in `sealStage = QUALIFIED` plus het
`postQualifiedKey`. Een tweede mechanisme voor hetzelfde probleem maakt het alleen
moeilijker uit te leggen. Als er ooit twéé accountants op één document tekenen,
wordt de veldnaam per accountant wél nodig; dat staat nu genoteerd, niet gebouwd.

## B4. Tweede herstartpunt — gebouwd zoals geadviseerd

`postQualifiedKey`, `postQualifiedSha256` en `sealStage` als echte enum. Migratie
met backfill, apart getest op synthetische rijen: een half-geschreven staat
(`sealedKey` gevuld maar `sealedSha256` leeg) landt op `PRESEAL` en wordt dus
opnieuw verzegeld. Dat is de veilige kant op.

Het advies om `sealStage` niet af te leiden uit gevulde sleutels was juist en
maakte meteen een tweede bug zichtbaar: `sealAndComplete` zette een dossier terug
in `WACHT_OP_WAARMERK` zolang er een `preSealKey` stond, ook als alles al
gekwalificeerd ondertekend was. Met de expliciete stage kan dat niet meer.

Het opruimen van `preSealKey` en `postQualifiedKey` na `SEALED` heb ik **niet**
gebouwd. Reden: het zijn versleutelde blobs op hetzelfde volume, ze zijn niet
groot, en zolang de verzegeling nog nergens in productie draait is een extra
opruimpad dat bestanden weggooit meer risico dan winst. Dit hoort bij de
ingebruikname, niet ervoor.

## B5. `signHash` persisteren en de 4.2-invariant — gebouwd zoals geadviseerd

`signatureValues` versleuteld met de bestaande envelope-encryptie, `sentHashes`
apart bewaard in exact de verstuurde vorm, invariant vóór injectie, drie
foutcategorieën uit 4.3, wissen direct na injectie én bij het opruimen van
verlopen sessies.

De zelfkritiek uit 4.1 is overgenomen in `docs/verzegeling.md`: er staat nu een
tabel met wat er tijdelijk in de database staat, waarom, en hoe lang, met de
expliciete opmerking dat dit nieuw is en dat de handtekeningwaarde de gevoeligste
van de drie is.

## B6. `/valideren` — 5.1 gebouwd, 5.2 niet

**5.1 SSRF: gebouwd.** `allow_fetching=False` op de publieke validator. De
regressietest controleert dat niet door naar de uitkomst te kijken maar door
`ValidationContext.__init__` te onderscheppen: geen enkele aanroep mag met
fetching aan gebeuren.

**Daarbij een tweede defect gevonden dat niet in de changeset stond.** Integriteit
en vertrouwen zaten in één aanroep. Faalt de vertrouwensvraag (onbekende CA, geen
ingebedde revocatiegegevens), dan sleepte die de integriteitsvraag mee in de val
en kreeg de lezer alleen een foutmelding — terwijl de vraag "is dit bestand
gewijzigd?" gewoon te beantwoorden is zonder keten en zonder netwerk. Dat is nu
gescheiden: eerst integriteit en dekking, dan pas het vertrouwen, en het resultaat
bevat beide met een apart `trustError`. Voor een kantoor dat een zegel van een
Nederlandse CA gebruikt die niet in pyHanko's trust store zit, is dat het
verschil tussen een bruikbare en een onbruikbare controlepagina.

**5.2 aparte validator-container: niet gebouwd, bewust.** De inverted guard is een
goed idee en de reden ervoor (over een half jaar staat er één gedeeld env-bestand)
is precies goed gezien. Maar met `allow_fetching=False` uit 5.1 is de scherpste
kant er af, en een zesde container brengt eigen risico: een tweede plek waar de
compose-configuratie kan afwijken, en een tweede image om bij te werken. Dit hoort
bij het moment dat er echte credentials in de sealer staan — nu staat daar niets,
want `SEAL_MODE=none`. Genoteerd als voorwaarde voor ingebruikname.

## B7. `SEAL_MODE=none` zichtbaar maken — alle drie de fasen gebouwd

Fase 1 en 2 waren gevraagd voor nu, fase 3 voor later; alle drie zijn er.

- Banner op dashboard en dossierpagina.
- Niet-onderdrukbare regel op het ondertekencertificaat.
- `VERZEGELING_OVERGESLAGEN` per document.
- `ALLOW_UNSEALED` als tweede vlag, met een leesbare foutmelding die vertelt wat
  je moet doen.

Fase 3 is meteen meegenomen omdat het vijftien regels is en het alternatief
"later, als we het niet vergeten" niet werkt.

**De ontwerpvraag ligt bij het kantoor:** gaat de voltooiingsmail uit bij
`SEAL_MODE=none`? Nu wel. Dat is de enige manier waarop een pilot bruikbaar is, en
de certificaatregel vertelt de ontvanger de waarheid. Als het kantoor het anders
wil, is het één regel.

## B8. Ketenverifier — 7.1 en 7.2 gebouwd, 7.3 niet

**7.1 was al gebouwd.** De ketenstart-invariant zat er al; alleen de tekst in de
code beweerde nog dat het niet kon. Dat is gecorrigeerd, in de code en in
`docs/beheer.md`, met de grens erbij: dit beschermt tegen DELETE en tegen
databasetoegang zonder applicatietoegang, niet tegen een mens met volledige
rechten die de noodschakelaar zelf kan zetten.

**7.2 grafsteen: gebouwd.** `BEWAARTERMIJN_OPGERUIMD` met dossiernaam, aantal
verwijderde regels, aantal documenten en de laatste hash van de opgeruimde keten.

**7.3 HMAC: niet gebouwd, bewust uitgesteld.** De analyse is juist — een kale hash
is door iedereen met INSERT-rechten na te rekenen. Maar de zelfkritiek in de
changeset noemt zelf de valkuil, en die is groot: `hmacKeyVersion` per regel, oude
sleutels die de hele bewaartermijn moeten blijven, sleutels buiten de back-up
houden, en een verifier die per rij de juiste sleutel kiest. Dat is een eigen
ronde met eigen migratie en eigen restoretest, en het raakt de back-upprocedure
die net is bewezen. Het bouwen ervan tussen de vier acute defecten door zou de
kans op een fout in juist dit onderdeel vergroten.

Wat er nu al staat en het realistische scenario grotendeels dekt: de
databasetrigger weigert UPDATE en DELETE, en de keten maakt elke wijziging
zichtbaar. Wie de trigger omzeilt heeft applicatierechten of superuser-rechten, en
dan helpt een HMAC-sleutel die in dezelfde env staat ook niet.

## B9. `REMINDER`, `EXPIRE`, `GEWEIGERD` — niet gebouwd, wacht op één besluit

De changeset zegt het zelf: dit is één gedeeld ontwerpbesluit, geen drie
handlers. Precies daarom is er niets gebouwd. Het voorstel in de changeset is
verdedigbaar en ik zou het overnemen:

- verzamelde handtekeningen en auditspoor blijven bewaard;
- niets verzegeld, geen voltooiingsmail;
- ongebruikte tokens ingetrokken;
- eigenaar krijgt bericht met de reden;
- niet heropenbaar, opnieuw versturen is een nieuw dossier met verwijzing.

Dat laatste punt is het enige met een echte consequentie voor de cliënt: die
krijgt een nieuwe link en moet opnieuw een code invoeren. Dat is uit te leggen, en
het houdt het auditspoor per dossier eenduidig, wat de hashketen nodig heeft.

**`GEWEIGERD` werkt al** (status, mail naar de eigenaar, auditregel). Wat mist is
`REMINDER` en `EXPIRE`. Dat `REMINDER` het grootste functionele gat is, klopt:
herinneringen zijn de dagelijkse reden waarom kantoren zo'n platform gebruiken.
Standaard na 5 en 12 dagen lijkt me goed. De nudge voor `WACHT_OP_WAARMERK` naar
de eigenaar is een goede toevoeging die ik zelf niet had gezien — daar staat nu
niets, en een dossier kan daar inderdaad blijven liggen terwijl de cliënt denkt
dat hij klaar is.

**Wat ik nodig heb om dit te bouwen:** ja/nee op het rijtje hierboven, en de twee
termijnen.

## B10. Kleinere punten

| # | Status | Toelichting |
|---|---|---|
| 9.1 dashboardfilter | **was al klaar** | `SEALING_FAILED` en `WACHT_OP_WAARMERK` zaten al in het filter, met banner en laatste foutmelding per dossier |
| 9.2 cap op SEAL_RETRY | **was al klaar** | retryable/definitief onderscheiden (400 vs 502), 12 pogingen (~9 uur), mail na de derde. Niet exact "24 uur", maar begrensd |
| 9.3 tesseract sandboxen | **deels** | eigen tempmap en timeout van 120s, maar niet dezelfde netwerkweigering als LibreOffice. Uploads komen van ingelogde medewerkers; genoteerd, niet gedaan |
| 9.4 rate limiting | **niet gedaan** | keuze voor het kantoor: startassertie bij meer dan één instance, of `RateLimiterPostgres`. Mijn voorkeur: Postgres, want de valkuil (`--scale web=2`) is te makkelijk |
| 9.5 certificaattekst | **was al klaar** | de uitleg over de per-persoon-hash stond er al |
| 9.6 kopie standaard aan | **was al klaar** | `sendCopyToRecipient @default(true)` |
| 9.7 sleutelversierapport | **niet gedaan** | zie hieronder |
| 9.8 batchgrens in de UI | **niet gedaan** | keuze voor het kantoor: harde grens op 50 met melding, of twee bevestigingen. Stil chunken doen we in geen geval |
| 9.9 LTA laten liggen | **geen werk** | `PADES_LEVEL=lt` is de standaard; de parameter blijft bestaan |

**Over 9.7, met antwoord op de twee vervolgvragen.** De versie verwijst naar de
**KEK**, niet naar de DEK. Elke blob heeft zijn eigen DEK, die versleuteld in de
header staat; de versie zegt met welke masterkey die DEK is ingepakt. Roteren is
dus in principe het herwikkelen van DEK's en niet het herschrijven van de inhoud —
maar `keys:rotate` herschrijft nu wel de hele blob, omdat de header en de inhoud in
één bestand zitten. Voor de omvang hier (documenten, geen media) is dat geen
probleem.

Het rapport dat scant welke versies nog voorkomen is er niet. Wat er wél is:
`keys:rotate` meldt na afloop of alles op de huidige versie staat, en een
ontbrekende sleutel geeft een expliciete melding met versienummer in plaats van
een cryptische fout. Het verschil is dat je het nu weet ná een rotatie en niet
onafhankelijk kunt aantonen. De restoretest met een **oude** sleutelversie is een
goed punt en staat er niet — dat is de meest waardevolle helft van 9.7.

## B11. Testsuite (punt 10) — bewust nog niet, maar wel een begin

De changeset zegt: bouw dit pas als 1 tot 5 vastliggen. Die liggen nu vast, maar
punt 8 nog niet, en dat raakt de toestandsmachine uit test 6. Daarom geen volledige
vitest/testcontainers-opzet.

Wat er wél staat, omdat het bewijs van de reparaties anders wegvalt:
`scripts/regressie/` met vijf scripts en `npm run test:regressie`, 42 controles
tegen een echte Postgres, plus 14 controles in een pytest-loze sealertest met een
zelfondertekend certificaat. Dat dekt uit de lijst van tien:

- **test 1 (golden PDF)** gedeeltelijk: verzegelen, valideren, en één omgeklapte
  byte wordt afgekeurd. Nog geen vaste fixture in CI.
- **test 3 (idempotentie)** ja: twee keer `/seal` geeft één zegel en een 409.
- **test 4 (ketenverifier)** drie van de vier scenario's: middenin verwijderd, kop
  verwijderd, één regel gemuteerd via de noodschakelaar. Het vierde
  (`hmacKeyVersion`) bestaat nog niet, zie B8.
- **test 5 (concurrency)** ja, en van beide races is aangetoond dat de test ze ook
  echt vangt door de vergrendeling er tijdelijk uit te halen.
- **test 8** deels: opslagrotatie round-trip en de bewaartermijn.

Wat mist: **test 2** (prepare-inject met kunstmatige vertraging — kan pas echt
tegen een provider), **test 6** (toestandsmachine, wacht op punt 8), **test 7**
(autorisatie per route — dit is het saaiste en waarschijnlijk nuttigste gat) en de
hele opzet in CI. Er is nog geen enkele test die automatisch draait bij een push.

---

# Deel C — Wat open staat

## C1. Vragen die bij het kantoor liggen, niet bij de bouw

1. **Punt 8:** het rijtje uit B9, plus de twee herinneringstermijnen.
2. **Voltooiingsmail bij `SEAL_MODE=none`:** nu wel, met de certificaatregel erbij.
   Vastleggen of dat zo blijft.
3. **Batchgrens (9.8):** harde grens op 50, of twee aangekondigde bevestigingen.
4. **Rate limiting (9.4):** startassertie of Postgres.
5. **Het niveauvraagstuk:** een aparte toegangscode als tweede kanaal voor
   `AKKOORD_IB` en `AKKOORD_VPB`. De schemavelden staan klaar, er is geen UI. De
   consequentie die de changeset noemt is juist: de sessie hangt aan `Recipient` en
   niet aan `Document`, dus als één document een code vereist geldt dat voor het
   hele verzoek. Plus een overgangsperiode waarin niet elke cliënt een code heeft.

## C2. Bewust niet gedaan (keuzes, geen vergeetlijst)

1. **Geen aparte toegangscode als tweede kanaal.** De tweede factor gaat naar
   hetzelfde e-mailadres als de link. De koppeling tussen handtekening en persoon
   rust dus op de mailbox van de ondertekenaar. Reële beperking; zie C1.5.
2. **Geen Visionplanner/AFAS/Exact-koppeling.** Documenten komen via upload binnen.
3. **Geen aparte `SEALED`-status.** `ONDERTEKEND` blijft de eindstatus; het
   onderscheid zit in `sealStage` per document. Een extra dossierstatus zou "klaar"
   over twee waarden splitsen.
4. **Rate limiting in het geheugen**, niet in Postgres. Zie C1.4.
5. **Geen PAdES-LTA-hervernieuwing.** Bij 7 jaar en B-LT met ingebedde OCSP/CRL is
   het geheel self-contained.
6. **In de UI geen juridische kwalificaties.** Er staat "digitaal ondertekend" en
   "verzegeld", niet "gekwalificeerd" of "eIDAS-niveau X" — behalve bij een echte
   beroepscertificaat-handtekening. Bewust geen overclaim.
7. **Geen HMAC op de auditketen.** Zie B8.
8. **Geen aparte validator-container.** Zie B6.

## C3. Wat nog niet in productie is bewezen

- **Verzegeling staat standaard uit** (`SEAL_MODE=none`); er is nog geen
  organisatiecertificaat en geen TSA-URL gekozen. Punt B4 en B7 zijn daarom alleen
  met een zelfondertekend testcertificaat aangetoond.
- **De CSC-netwerkaanroepen zijn niet tegen een echte provider getest** — de
  ontwikkelomgeving mag Cleverbase niet bereiken (403 op de proxy). `npm run
  csc:check` zoekt twee punten uit waarover hun documentatie niet eenduidig is:
  gaat de `service`-scope via client_credentials, en hoe ziet een verlopen SAD eruit.
  Bouw geen aannames over het gedrag van de `service`-scope vast zonder die uitkomst.
- **De PDF-kant van het tweefasige ondertekenen is wél end-to-end bewezen.**
- **Mailprovider nog niet gekozen**; SMTP werkt, de webhook-verwerking is getest
  met nagemaakte payloads van beide providers.
- **Geen CI.** De regressiescripts draaien handmatig. Dat is het grootste
  resterende gat in het proces, los van welke functie dan ook.

## C4. Waar een volgende review het meest oplevert

Suggesties, geen beperking:

1. **De vergrendelingskeuzes.** Twee races zijn met een lock opgelost:
   `FOR UPDATE` per document en een advisory lock per auditketen. Zijn er paden
   waar die vergrendelingen elkaar kunnen kruisen, of waar een derde race zit die
   nog niemand heeft aangeraakt? Deadlock-risico bij een dossier met veel
   documenten en veel ondertekenaars?
2. **De keuze in B1.** Stempelen binnen een lock in submit, in plaats van
   artefacten bewaren en één keer stempelen in de finalisatie. Is de verloren
   reproduceerbaarheid van de stempelvolgorde een probleem dat ik onderschat?
3. **De scheiding integriteit/vertrouwen in `/validate`** (B6). Klopt de bewering
   dat integriteit zonder keten en zonder netwerk vast te stellen is, en communiceert
   de pagina dat begrijpelijk voor een cliënt of een bank?
4. **Het uitstel van 7.3 (HMAC).** Is de afweging verdedigbaar, of is dit het punt
   waarop uitstel de kans dat het ooit gebeurt tot nul reduceert?
5. **Punt 8 zelf:** het voorstel uit B9 kritisch tegenlicht houden, vooral "niet
   heropenbaar".
6. **Autorisatie per route** (test 7 uit punt 10). Dat is het saaiste gat en
   waarschijnlijk het gat waar na een refactor een IDOR terugkomt.

## C5. Documentatie in de repo

`docs/verzegeling.md` (verzegeling, tijdstempel, beroepscertificaat, mail, en wat
er tijdelijk in de database staat), `docs/beheer.md` (back-up, bewaartermijn,
sleutelrotatie, achtergrondtaken, regressietests, en de grens van de append-only
trigger), `docs/hosting-handleiding.md`, `docs/handleiding/`
(gebruikershandleiding v3.0, 28 pagina's, met schermafbeeldingen).
