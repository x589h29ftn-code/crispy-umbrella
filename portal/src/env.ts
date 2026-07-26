import { z } from 'zod'

// Zod-gevalideerde omgeving. Faalt hard (fail-fast) bij het opstarten van de
// server als een verplichte variabele ontbreekt of te zwak is. Zo draait het
// portaal nooit per ongeluk met onveilige of ontbrekende geheimen.

const secret = z.string().min(32, 'geheim moet minimaal 32 tekens zijn')

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),

  SESSION_SECRET: secret,
  SIGNING_TOKEN_SECRET: secret,
  STORAGE_ENCRYPTION_KEY: z.string().min(32),
  TOTP_ENCRYPTION_KEY: z.string().min(32),
  // Sleutelrotatie. De variabele hierboven is altijd versie 1; extra versies
  // komen uit ..._V2, ..._V3 enzovoort en ..._CURRENT bepaalt waarmee nieuwe
  // data wordt versleuteld. Oude data blijft leesbaar zolang die sleutel er is.
  // Hier alleen de eerste paar versies verklaard zodat een typefout opvalt; de
  // sleutelring valideert de rest bij gebruik.
  STORAGE_ENCRYPTION_KEY_V2: z.string().min(32).optional(),
  STORAGE_ENCRYPTION_KEY_V3: z.string().min(32).optional(),
  STORAGE_ENCRYPTION_KEY_CURRENT: z.coerce.number().int().min(1).max(20).optional(),
  TOTP_ENCRYPTION_KEY_V2: z.string().min(32).optional(),
  TOTP_ENCRYPTION_KEY_V3: z.string().min(32).optional(),
  TOTP_ENCRYPTION_KEY_CURRENT: z.coerce.number().int().min(1).max(20).optional(),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  STORAGE_DIR: z.string().default('/data/documents'),

  MAIL_TRANSPORT: z.enum(['smtp', 'postmark', 'resend']).default('smtp'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  // STARTTLS afdwingen (standaard aan; lokaal met een mailcatcher op 'false').
  SMTP_REQUIRE_TLS: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('Otto Visser & Partners <noreply@ottovisseraccountants.nl>'),
  POSTMARK_TOKEN: z.string().optional(),
  POSTMARK_MESSAGE_STREAM: z.string().default('outbound'),
  RESEND_API_KEY: z.string().optional(),
  // Openen meten via een tracking-pixel. Standaard uit: het is in twee
  // richtingen onbetrouwbaar (geblokkeerde afbeeldingen missen een opening,
  // privacybescherming die mail vooraf ophaalt meldt een opening die er niet was).
  MAIL_TRACK_OPENS: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Beveiliging van het webhook-eindpunt. Postmark: HTTP-basicauth op de URL,
  // eventueel met een IP-lijst. Resend: Svix-signatuur.
  MAIL_WEBHOOK_USER: z.string().optional(),
  MAIL_WEBHOOK_PASSWORD: z.string().optional(),
  // Komma-gescheiden lijst; leeg = geen IP-beperking.
  MAIL_WEBHOOK_IPS: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),

  // Sms (optioneel; alleen nodig als cliënten sms-verificatie kiezen).
  SMS_PROVIDER: z.enum(['none', 'messagebird', 'twilio']).default('none'),
  SMS_ORIGINATOR: z.string().optional(),
  MESSAGEBIRD_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  SIGN_LINK_TTL_DAYS: z.coerce.number().int().positive().default(10),
  // Hoeveel dagen het portaal de DOCUMENTBESTANDEN bewaart na het archiveervinkje.
  // Het auditspoor blijft zeven jaar; zie lib/retention.ts.
  BLOB_RETENTION_DAYS: z.coerce.number().int().positive().max(3650).default(90),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),

  // Zware documentbewerkingen (LibreOffice, OCR) één tegelijk over alle containers
  // heen. Standaard aan: op een machine van 4 GB is twee keer LibreOffice of
  // LibreOffice naast tesseract de manier waarop de server omvalt. Uitzetten is
  // alleen voor tests zonder database.
  DOCPREP_SERIALIZE: z
    .string()
    .default('true')
    .transform((v) => v !== 'false'),

  // Virusscan op uploads (optioneel). none = uit; clamav = via een ClamAV-daemon.
  //
  // Blijft standaard UIT, en dat is een afweging en geen vergetelheid: een residente
  // clamd vraagt 1,5 tot 2 GB voor de virusdefinities, en dat is de helft van deze
  // machine. Uploads komen alleen van ingelogde medewerkers vanaf kantoormachines
  // met eigen endpointbescherming. Zie docs/beheer.md.
  VIRUS_SCAN: z.enum(['none', 'clamav']).default('none'),
  CLAMD_HOST: z.string().default('clamav'),
  CLAMD_PORT: z.coerce.number().default(3310),

  // Archief: getekende stukken automatisch wegschrijven naar de klantmap.
  // none = uit; folder = naar een (gekoppelde) map; sharepoint = Microsoft 365.
  ARCHIVE_DRIVER: z.enum(['none', 'folder', 'sharepoint']).default('none'),
  ARCHIVE_DIR: z.string().default('/data/archive'),
  // SharePoint via Microsoft Graph (client-credentials).
  SHAREPOINT_TENANT_ID: z.string().optional(),
  SHAREPOINT_CLIENT_ID: z.string().optional(),
  SHAREPOINT_CLIENT_SECRET: z.string().optional(),
  SHAREPOINT_DRIVE_ID: z.string().optional(),
  // Basismap in de bibliotheek, bijv. "Getekende stukken". Leeg = de root.
  SHAREPOINT_BASE_FOLDER: z.string().optional(),

  // Beroepscertificaat: gekwalificeerd ondertekenen op persoonlijke titel
  // (accountant AA/RA) via een gemachtigde TSP. none = uit (standaard, geen
  // certificaat nodig); cleverbase = de CSC-route waarbij de accountant zelf
  // autoriseert. Per accountant zet je het aan onder Gebruikers.
  //
  // 'digidentity' staat er alleen nog in om een bestaand .env-bestand een
  // duidelijke foutmelding te geven in plaats van een stille gedragswijziging;
  // de driver zelf is verwijderd. Zie assertOneSigningMechanism hieronder.
  PROFESSIONAL_SIGNING_DRIVER: z.enum(['none', 'digidentity', 'cleverbase']).default('none'),

  // Cleverbase (CSC v1). De ACCOUNTANT autoriseert zelf: het portaal stuurt hem
  // via een browserredirect naar Cleverbase, waar hij in de app met pincode
  // bevestigt. Eén bevestiging dekt tot 50 hashes.
  CLEVERBASE_CSC_BASE_URL: z.string().optional(),
  CLEVERBASE_CSC_CLIENT_ID: z.string().optional(),
  CLEVERBASE_CSC_CLIENT_SECRET: z.string().optional(),
  // Leeg = geen omgeving gekozen (dan faalt de driver bij gebruik). 'stub' mag
  // uitsluitend buiten productie; zie de guard onder het schema.
  CLEVERBASE_CSC_ENV: z.enum(['', 'stub', 'production']).default(''),
  // Absolute HTTPS-URL, vooraf bij Cleverbase geregistreerd. Wijzigen betekent
  // opnieuw registreren, dus houd hem stabiel.
  CLEVERBASE_REDIRECT_URI: z.string().optional(),
  CLEVERBASE_MAX_BATCH: z.coerce.number().int().min(1).max(50).default(50),
  // Revocatie-eindpunt voor de LT-laag (wordt door pyHanko opgehaald/ingebed).
  CLEVERBASE_CRL_URL: z.string().default('https://pki.cleverbase.com/cleverbase3c.crl'),
  // Hoe lang een ondertekensessie mag lopen. De SAD zelf leeft 300 s; daarna
  // faalt de hele batch en moet de accountant opnieuw beginnen.
  CLEVERBASE_SIGN_TIMEOUT_MS: z.coerce.number().int().positive().default(300000),
  // Op welke documentsoorten de accountant als AUTEUR ondertekent ("Ondertekend
  // door <naam>, RA") in plaats van als zegel ("Verzegeld door Otto Visser &
  // Partners Accountants"). Komma-gescheiden DocumentKind-namen. Leeg = de
  // standaard uit lib/signing-labels.ts (alleen JAARREKENING).
  //
  // Instelling en geen code, zodat de vraag "teken je op de aangifte zelf of alleen
  // op de akkoordbrief?" later beantwoord kan worden zonder nieuwe versie.
  SIGN_AS_AUTHOR_KINDS: z.string().default(''),

  // === Cryptografische verzegeling (PAdES) via de sealer-sidecar ===
  //
  // none         = geen cryptografische handtekening; alleen de zichtbare stempels
  //                en het auditcertificaat. Vereist ALLOW_UNSEALED in productie.
  // organisation = ROUTE A, de normale route. Het organisatiezegel is de enige
  //                cryptografische handtekening in een dossier: certificerend,
  //                DocMDP P=1, onbeheerd en onzichtbaar. Een jaarrekening krijgt
  //                bij samenstellen geen beroepscertificaat — dat is niet
  //                voorgeschreven — dus dit dekt het dagelijkse werk.
  // qualified    = ROUTE B, de uitzondering. Alleen voor documentsoorten waar een
  //                beroepscertificaat wél vereist is (SBR-accountantsverklaring,
  //                waarmerken van een SBR-jaarrekening). De accountant autoriseert
  //                zelf via de CSC-koppeling.
  //
  // 'sealer' is de oude naam van 'qualified' en wordt nog geaccepteerd zodat een
  // bestaand .env-bestand niet stilvalt.
  SEAL_MODE: z
    .enum(['none', 'qualified', 'organisation', 'sealer'])
    .default('none')
    .transform((v) => (v === 'sealer' ? 'qualified' : v)),
  // Zonder verzegeling gaan er stukken de deur uit zonder cryptografische
  // bescherming. Dat mag tijdens een pilot, maar niet per ongeluk: in productie
  // moet die keuze expliciet met een tweede vlag worden bevestigd.
  ALLOW_UNSEALED: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),
  // Interne URL van de sidecar; niet publiek bereikbaar (geen Caddy-route).
  SEALER_URL: z.string().default('http://sealer:8000'),
  // Optioneel: een aparte sidecar voor het valideren, zonder ondertekengegevens in
  // zijn omgeving. Niet nodig zolang /valideren achter de login zit — er is dan geen
  // onbeauthenticeerde uploadingang. Wordt hij ooit weer publiek, dan is dit de weg
  // terug; zie docs/hosting-handleiding.md.
  SEALER_VALIDATE_URL: z.string().optional(),
  // Shared secret in een header tussen web en sealer.
  SEALER_SHARED_SECRET: z.string().optional(),
  SEALER_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  // Waar de rate-limitertellers staan. 'postgres' is de standaard: bij meerdere
  // webcontainers gelden in-memory limieten per container en is de bescherming
  // feitelijk verzwakt. 'memory' is er voor tests zonder database.
  RATE_LIMIT_STORE: z.enum(['postgres', 'memory']).default('postgres'),

  // === Ankers van het auditspoor (buiten de database) ===
  // Komma-gescheiden: 'archief' en/of 'mail'. Leeg = geen ankers.
  AUDIT_ANCHOR_TARGETS: z.string().default(''),
  AUDIT_ANCHOR_MAIL_TO: z.string().email().optional(),
  AUDIT_ANCHOR_ARCHIVE_FOLDER: z.string().default('_Auditankers'),

  // === Tijdstempel (TSA) — gelezen door de sidecar, hier gevalideerd zodat een
  // typefout bij het opstarten zichtbaar wordt in plaats van pas bij ondertekenen.
  TSA_URL: z.string().optional(),
  TSA_AUTH_MODE: z.enum(['none', 'basic', 'bearer']).default('none'),
  TSA_USERNAME: z.string().optional(),
  TSA_PASSWORD: z.string().optional(),
  TSA_TIMEOUT_MS: z.coerce.number().int().positive().default(10000),
  PADES_LEVEL: z.enum(['lt', 'lta']).default('lt'),
  // Welke driver de sidecar gebruikt voor het organisatiezegel.
  SEAL_DRIVER: z.enum(['csc', 'globalsign_dss']).default('csc'),

  // Aantal vertrouwde proxy-hops vóór de app (Caddy = 1). Bepaalt hoeveel
  // waarden uit X-Forwarded-For te vertrouwen zijn.
  TRUSTED_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(1),

  // Achtergrondwerker: interval en hoeveel jobs per ronde.
  WORKER_POLL_MS: z.coerce.number().int().positive().default(15000),
  WORKER_BATCH: z.coerce.number().int().positive().default(5)
})

// In dev tolereren we ontbrekende geheimen met veilige placeholders zodat je
// zonder volledige .env kunt ontwikkelen; in productie is alles verplicht.
function withDevDefaults(raw: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (raw.NODE_ENV === 'production') return raw
  const devSecret = 'dev-only-onveilig-geheim-minstens-32-tekens-lang'
  return {
    ...raw,
    APP_URL: raw.APP_URL ?? 'http://localhost:3000',
    DATABASE_URL: raw.DATABASE_URL ?? 'postgresql://ovp:ovp@localhost:5432/ovp_portaal?schema=public',
    SESSION_SECRET: raw.SESSION_SECRET ?? devSecret,
    SIGNING_TOKEN_SECRET: raw.SIGNING_TOKEN_SECRET ?? devSecret + '-signing',
    STORAGE_ENCRYPTION_KEY: raw.STORAGE_ENCRYPTION_KEY ?? devSecret + '-storage',
    TOTP_ENCRYPTION_KEY: raw.TOTP_ENCRYPTION_KEY ?? devSecret + '-totp'
  }
}

// Openbare stub-credentials van Cleverbase, bedoeld voor ontwikkelen en testen.
// Ze staan in hun documentatie en zijn dus wereldwijd bekend: nooit in productie.
export const CLEVERBASE_STUB_CLIENT_ID = '6dd5f48d-bcd9-4a98-8a4c-5c82182f5be4'

/**
 * Weigert een productiestart met de openbare teststub. Bewust een harde fout en
 * geen waarschuwing: met deze credentials kan iedereen ondertekenverzoeken doen.
 */
export function assertNoStubInProduction(cfg: {
  NODE_ENV: string
  CLEVERBASE_CSC_ENV: string
  CLEVERBASE_CSC_CLIENT_ID?: string
}): void {
  if (cfg.NODE_ENV !== 'production') return
  if (cfg.CLEVERBASE_CSC_ENV === 'stub') {
    throw new Error(
      'CLEVERBASE_CSC_ENV=stub mag niet in productie. Zet hem op "production" met eigen, ' +
        'bij Cleverbase geregistreerde clientgegevens.'
    )
  }
  if (cfg.CLEVERBASE_CSC_CLIENT_ID && cfg.CLEVERBASE_CSC_CLIENT_ID.trim() === CLEVERBASE_STUB_CLIENT_ID) {
    throw new Error(
      'CLEVERBASE_CSC_CLIENT_ID is de openbare teststub van Cleverbase; die mag niet in productie. ' +
        'Vraag eigen clientgegevens aan en registreer je redirect-URI.'
    )
  }
}

/**
 * Weigert een productiestart met verzegeling uit, tenzij dat expliciet is
 * bevestigd. Eén vlag zet iemand per ongeluk; twee niet.
 */
export function assertSealingChoiceIsDeliberate(cfg: {
  NODE_ENV: string
  SEAL_MODE: string
  ALLOW_UNSEALED: boolean
}): void {
  if (cfg.NODE_ENV !== 'production') return
  if (cfg.SEAL_MODE !== 'none') return
  if (cfg.ALLOW_UNSEALED) return
  throw new Error(
    'SEAL_MODE=none in productie: verzonden documenten zijn dan niet cryptografisch ' +
      'beschermd. Is dat bewust (bijvoorbeeld tijdens een pilot zonder certificaat), zet dan ' +
      'ook ALLOW_UNSEALED=true. Anders: stel een organisatiecertificaat en TSA_URL in bij de ' +
      'sealer en zet SEAL_MODE=organisation.'
  )
}

/**
 * De ingebruiknamegrendel.
 *
 * Bij `SEAL_MODE=qualified` is de gekwalificeerde handtekening van de accountant DE
 * verzegeling. Er is dan geen organisatiezegel, dus als de provider niet is
 * ingesteld, wordt er niets verzegeld terwijl de configuratie zegt van wel. Dat is
 * de gevaarlijkste stille toestand die er is: stukken gaan de deur uit die niemand
 * later kan valideren, en niets in de status verraadt het.
 *
 * `organisation` is gereserveerd en niet gebouwd. Beter een leesbare weigering dan
 * een halve implementatie.
 *
 * Zie docs/hosting-handleiding.md voor de afvinklijst.
 */
export function assertReadyForRealSealing(cfg: {
  SEAL_MODE: string
  PROFESSIONAL_SIGNING_DRIVER: string
}): void {
  if (cfg.SEAL_MODE === 'none') return
  if (cfg.SEAL_MODE === 'organisation') {
    // Route A. Het zegel komt uit de sealer-sidecar, die zijn eigen
    // SEAL_CSC_*-gegevens heeft; de webapp heeft er verder geen instelling voor.
    // Wel controleren dat er niet per ongeluk óók een beroepscertificaatroute
    // aanstaat, want dan is onduidelijk welke van de twee het dossier afsluit.
    return
  }
  if (cfg.SEAL_MODE === 'qualified' && cfg.PROFESSIONAL_SIGNING_DRIVER === 'none') {
    throw new Error(
      'SEAL_MODE=qualified betekent dat de gekwalificeerde handtekening van de accountant de ' +
        'verzegeling is, maar PROFESSIONAL_SIGNING_DRIVER staat op "none". Er zou dan niets worden ' +
        'verzegeld terwijl de configuratie zegt van wel.\n\n' +
        'Zet PROFESSIONAL_SIGNING_DRIVER=cleverbase met de bijbehorende gegevens, of zet ' +
        'SEAL_MODE=none met ALLOW_UNSEALED=true zolang er nog geen certificaat is.'
    )
  }
}

/**
 * Eén ondertekenmechanisme.
 *
 * De digidentity-driver tekende tijdens het ondertekenen namens de accountant,
 * en deed dat best-effort: viel de provider weg, dan bleef alleen het zichtbare
 * stempel staan en liep het dossier door naar ONDERTEKEND. Een document dat
 * ondertekend oogt zonder gekwalificeerde handtekening — precies op het punt
 * waar je op vertrouwt.
 *
 * De driver is verwijderd. Deze grendel staat er zodat een bestaand
 * .env-bestand een leesbare weigering krijgt in plaats van stilletjes ander
 * gedrag te vertonen. Bewust vóór de SEAL_MODE-check: ook met SEAL_MODE=none
 * zou de instelling suggereren dat er gewaarmerkt wordt.
 */
export function assertOneSigningMechanism(cfg: { PROFESSIONAL_SIGNING_DRIVER: string }): void {
  if (cfg.PROFESSIONAL_SIGNING_DRIVER !== 'digidentity') return
  throw new Error(
    'PROFESSIONAL_SIGNING_DRIVER=digidentity bestaat niet meer. Die driver tekende namens de ' +
      'accountant en viel stil terug op alleen een zichtbaar stempel als de provider wegviel.\n\n' +
      'Er is nog één mechanisme: zet PROFESSIONAL_SIGNING_DRIVER=cleverbase (de accountant ' +
      'autoriseert zelf met pincode), of PROFESSIONAL_SIGNING_DRIVER=none als er nog geen ' +
      'beroepscertificaat is.'
  )
}

let cached: z.infer<typeof schema> | null = null

export function getEnv(): z.infer<typeof schema> {
  if (cached) return cached
  const parsed = schema.safeParse(withDevDefaults(process.env))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Ongeldige of ontbrekende omgevingsvariabelen:\n${issues}`)
  }
  assertNoStubInProduction(parsed.data)
  assertOneSigningMechanism(parsed.data)
  assertSealingChoiceIsDeliberate(parsed.data)
  assertReadyForRealSealing(parsed.data)
  cached = parsed.data
  return cached
}

export const env = new Proxy({} as z.infer<typeof schema>, {
  get(_t, prop: string) {
    return getEnv()[prop as keyof z.infer<typeof schema>]
  }
})
