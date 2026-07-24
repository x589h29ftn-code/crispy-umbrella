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
  RESEND_API_KEY: z.string().optional(),

  // Sms (optioneel; alleen nodig als cliënten sms-verificatie kiezen).
  SMS_PROVIDER: z.enum(['none', 'messagebird', 'twilio']).default('none'),
  SMS_ORIGINATOR: z.string().optional(),
  MESSAGEBIRD_API_KEY: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_FROM: z.string().optional(),

  SIGN_LINK_TTL_DAYS: z.coerce.number().int().positive().default(10),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10),

  // Virusscan op uploads (optioneel). none = uit; clamav = via een ClamAV-daemon.
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
  // certificaat nodig); digidentity = PKIoverheid-beroepscertificaat in de
  // cloud via de CSC-API. Per accountant zet je het aan onder Gebruikers.
  PROFESSIONAL_SIGNING_DRIVER: z.enum(['none', 'digidentity']).default('none'),
  // Digidentity CSC/AutoSign (OAuth2 client-credentials). Alleen nodig als de
  // driver op 'digidentity' staat. Testtoegang via hun Sales/Implementation-team.
  DIGIDENTITY_BASE_URL: z.string().optional(),
  DIGIDENTITY_CLIENT_ID: z.string().optional(),
  DIGIDENTITY_CLIENT_SECRET: z.string().optional(),
  DIGIDENTITY_SCOPE: z.string().optional(),

  // === Cryptografische verzegeling (PAdES) via de sealer-sidecar ===
  // none = uit (geen zegel; alleen de zichtbare stempels en het auditcertificaat).
  // sealer = verzegelen via de interne Python-sidecar (pyHanko).
  SEAL_MODE: z.enum(['none', 'sealer']).default('none'),
  // Interne URL van de sidecar; niet publiek bereikbaar (geen Caddy-route).
  SEALER_URL: z.string().default('http://sealer:8000'),
  // Shared secret in een header tussen web en sealer.
  SEALER_SHARED_SECRET: z.string().optional(),
  SEALER_TIMEOUT_MS: z.coerce.number().int().positive().default(60000),
  // Ook verzegelen wanneer er al een gekwalificeerde handtekening in staat?
  SEAL_WHEN_QUALIFIED_PRESENT: z
    .string()
    .default('false')
    .transform((v) => v === 'true'),

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

let cached: z.infer<typeof schema> | null = null

export function getEnv(): z.infer<typeof schema> {
  if (cached) return cached
  const parsed = schema.safeParse(withDevDefaults(process.env))
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n')
    throw new Error(`Ongeldige of ontbrekende omgevingsvariabelen:\n${issues}`)
  }
  cached = parsed.data
  return cached
}

export const env = new Proxy({} as z.infer<typeof schema>, {
  get(_t, prop: string) {
    return getEnv()[prop as keyof z.infer<typeof schema>]
  }
})
