import 'server-only'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from '@/env'

// Verificatie van inkomende webhooks. Een onverifieerbare call wordt geweigerd:
// anders kan iedereen bezorgstatussen in ons bewijsdossier schrijven.

/** Vergelijkt in constante tijd, ook bij verschillende lengtes. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Postmark: HTTP-basicauth op de webhook-URL. */
export function verifyBasicAuth(header: string | null): boolean {
  const user = env.MAIL_WEBHOOK_USER
  const pass = env.MAIL_WEBHOOK_PASSWORD
  // Niet ingesteld = niets te verifiëren = weigeren. Nooit stilzwijgend open.
  if (!user || !pass) return false
  if (!header?.startsWith('Basic ')) return false
  let decoded: string
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8')
  } catch {
    return false
  }
  const idx = decoded.indexOf(':')
  if (idx < 0) return false
  return safeEqual(decoded.slice(0, idx), user) && safeEqual(decoded.slice(idx + 1), pass)
}

/** Optionele IP-lijst als extra slot bovenop de basicauth. */
export function ipAllowed(ip: string | undefined): boolean {
  const list = (env.MAIL_WEBHOOK_IPS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (list.length === 0) return true // geen lijst ingesteld = geen beperking
  return !!ip && list.includes(ip)
}

/**
 * Resend gebruikt Svix: HMAC-SHA256 over "<id>.<timestamp>.<body>" met het
 * geheim na 'whsec_'. De header kan meerdere versies bevatten (v1,<sig> ...).
 */
export function verifySvixSignature(input: {
  id: string | null
  timestamp: string | null
  signature: string | null
  body: string
  toleranceSeconds?: number
}): boolean {
  const secretRaw = env.RESEND_WEBHOOK_SECRET
  if (!secretRaw) return false
  const { id, timestamp, signature, body } = input
  if (!id || !timestamp || !signature) return false

  // Oude berichten weigeren, zodat een onderschepte call niet later herbruikbaar is.
  const ts = Number(timestamp)
  if (!Number.isFinite(ts)) return false
  const tolerance = input.toleranceSeconds ?? 300
  if (Math.abs(Date.now() / 1000 - ts) > tolerance) return false

  const secret = Buffer.from(secretRaw.replace(/^whsec_/, ''), 'base64')
  const expected = createHmac('sha256', secret).update(`${id}.${timestamp}.${body}`).digest('base64')
  // De header bevat één of meer "v1,<signatuur>"-paren.
  return signature
    .split(' ')
    .map((part) => part.trim())
    .filter((part) => part.startsWith('v1,'))
    .some((part) => safeEqual(part.slice(3), expected))
}

export interface NormalisedMailEvent {
  providerEventId: string
  type: 'Delivery' | 'Bounce' | 'SpamComplaint' | 'Open' | 'Other'
  messageId: string | null
  /** 'hard' of 'soft'; alleen bij Bounce. */
  bounceType?: 'hard' | 'soft'
  bounceReason?: string
  occurredAt: Date
}

// Postmark-bouncetypes die tijdelijk zijn: die mogen één keer opnieuw.
const POSTMARK_SOFT = new Set([
  'SoftBounce',
  'Transient',
  'DnsError',
  'SMTPApiError',
  'ChallengeVerification',
  'AddressChange',
  'AutoResponder'
])

/** Zet een Postmark-payload om naar één genormaliseerde gebeurtenis. */
export function normalisePostmark(payload: Record<string, unknown>): NormalisedMailEvent | null {
  const type = String(payload.RecordType ?? '')
  const messageId = typeof payload.MessageID === 'string' ? payload.MessageID : null
  const stamp = String(payload.DeliveredAt ?? payload.BouncedAt ?? payload.ReceivedAt ?? '')
  const occurredAt = stamp && !Number.isNaN(Date.parse(stamp)) ? new Date(stamp) : new Date()

  switch (type) {
    case 'Delivery':
      return { providerEventId: `pm-delivery-${messageId}`, type: 'Delivery', messageId, occurredAt }
    case 'Bounce': {
      const bounceId = payload.ID ?? messageId
      const pmType = String(payload.Type ?? '')
      // Postmark meldt expliciet of het adres niet meer bestaat.
      const inactive = payload.Inactive === true
      const soft = POSTMARK_SOFT.has(pmType) && !inactive
      return {
        providerEventId: `pm-bounce-${bounceId}`,
        type: 'Bounce',
        messageId,
        bounceType: soft ? 'soft' : 'hard',
        bounceReason: `${pmType}: ${String(payload.Description ?? payload.Details ?? '')}`.slice(0, 500),
        occurredAt
      }
    }
    case 'SpamComplaint':
      return {
        providerEventId: `pm-spam-${payload.ID ?? messageId}`,
        type: 'SpamComplaint',
        messageId,
        occurredAt
      }
    case 'Open':
      return {
        // Postmark stuurt meerdere opens; alleen de eerste is interessant.
        providerEventId: `pm-open-${messageId}`,
        type: 'Open',
        messageId,
        occurredAt
      }
    default:
      return null
  }
}

/** Zet een Resend-payload om naar één genormaliseerde gebeurtenis. */
export function normaliseResend(
  payload: Record<string, unknown>,
  svixId: string | null
): NormalisedMailEvent | null {
  const type = String(payload.type ?? '')
  const data = (payload.data ?? {}) as Record<string, unknown>
  const messageId = typeof data.email_id === 'string' ? data.email_id : null
  const stamp = String(payload.created_at ?? '')
  const occurredAt = stamp && !Number.isNaN(Date.parse(stamp)) ? new Date(stamp) : new Date()
  // De Svix-id is per aflevering uniek en daarmee de beste dedupe-sleutel.
  const providerEventId = svixId ? `rs-${svixId}` : `rs-${type}-${messageId}`

  switch (type) {
    case 'email.delivered':
      return { providerEventId, type: 'Delivery', messageId, occurredAt }
    case 'email.bounced': {
      const bounce = (data.bounce ?? {}) as Record<string, unknown>
      const cls = String(bounce.type ?? bounce.subType ?? '').toLowerCase()
      return {
        providerEventId,
        type: 'Bounce',
        messageId,
        bounceType: cls.includes('transient') || cls.includes('soft') ? 'soft' : 'hard',
        bounceReason: String(bounce.message ?? cls ?? 'onbekend').slice(0, 500),
        occurredAt
      }
    }
    case 'email.complained':
      return { providerEventId, type: 'SpamComplaint', messageId, occurredAt }
    case 'email.opened':
      return { providerEventId, type: 'Open', messageId, occurredAt }
    default:
      return null
  }
}
