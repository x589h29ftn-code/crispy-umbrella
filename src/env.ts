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

  SIGN_LINK_TTL_DAYS: z.coerce.number().int().positive().default(14),
  OTP_TTL_MINUTES: z.coerce.number().int().positive().default(10)
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
