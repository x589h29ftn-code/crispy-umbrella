import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '@/env'

// Env-gedreven e-mailtransport: smtp (Microsoft 365) | postmark | resend.
//
// Waarom een transactionele provider de voorkeur heeft: bij SMTP weet je alleen
// dat je de mail aan de server hebt aangeboden. Of hij is afgeleverd, gebounced
// of in de spamfolder belandde, weet je niet. In een bewijsdossier is "verzonden"
// daarmee de zwakste schakel — en precies de schakel waar een betwisting begint.
// Postmark en Resend geven een message-id terug en koppelen de bezorgstatus terug
// via een webhook (zie src/app/api/webhooks/mail/route.ts).

let cached: Transporter | null = null

function smtpTransport(): Transporter {
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 587,
    secure: env.SMTP_SECURE ?? false, // false = STARTTLS op 587
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
    requireTLS: env.SMTP_REQUIRE_TLS
  })
}

export function mailer(): Transporter {
  if (!cached) cached = smtpTransport()
  return cached
}

export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
  attachments?: { filename: string; content: Buffer }[]
}

export interface SendResult {
  /** Message-id van de provider; nodig om webhooks aan een ontvanger te koppelen. */
  messageId: string | null
  provider: 'smtp' | 'postmark' | 'resend'
}

class MailSendError extends Error {}

async function sendViaPostmark(msg: MailMessage): Promise<SendResult> {
  const token = env.POSTMARK_TOKEN
  if (!token) throw new MailSendError('POSTMARK_TOKEN ontbreekt.')
  const res = await fetch('https://api.postmarkapp.com/email', {
    method: 'POST',
    headers: {
      'X-Postmark-Server-Token': token,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify({
      From: env.MAIL_FROM,
      To: msg.to,
      Subject: msg.subject,
      TextBody: msg.text,
      HtmlBody: msg.html,
      MessageStream: env.POSTMARK_MESSAGE_STREAM,
      // Openen is onbetrouwbaar; alleen aanzetten als het bewust is ingesteld.
      TrackOpens: env.MAIL_TRACK_OPENS,
      Attachments: msg.attachments?.map((a) => ({
        Name: a.filename,
        Content: a.content.toString('base64'),
        ContentType: 'application/pdf'
      }))
    })
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new MailSendError(`Postmark gaf ${res.status}: ${String(body.Message ?? '').slice(0, 300)}`)
  }
  return { messageId: typeof body.MessageID === 'string' ? body.MessageID : null, provider: 'postmark' }
}

async function sendViaResend(msg: MailMessage): Promise<SendResult> {
  const key = env.RESEND_API_KEY
  if (!key) throw new MailSendError('RESEND_API_KEY ontbreekt.')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: env.MAIL_FROM,
      to: [msg.to],
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: msg.attachments?.map((a) => ({
        filename: a.filename,
        content: a.content.toString('base64')
      }))
    })
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new MailSendError(`Resend gaf ${res.status}: ${JSON.stringify(body).slice(0, 300)}`)
  }
  return { messageId: typeof body.id === 'string' ? body.id : null, provider: 'resend' }
}

async function sendViaSmtp(msg: MailMessage): Promise<SendResult> {
  const info = await mailer().sendMail({
    from: env.MAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    attachments: msg.attachments
  })
  // SMTP geeft wel een message-id, maar geen bezorgstatus achteraf.
  return { messageId: info.messageId ?? null, provider: 'smtp' }
}

/**
 * Verstuurt één mail en geeft het message-id terug. Gooit bij mislukken; de
 * aanroeper bepaalt of dat de flow mag blokkeren.
 */
export async function sendMail(msg: MailMessage): Promise<SendResult> {
  switch (env.MAIL_TRANSPORT) {
    case 'postmark':
      return sendViaPostmark(msg)
    case 'resend':
      return sendViaResend(msg)
    case 'smtp':
    default:
      return sendViaSmtp(msg)
  }
}

/** Koppelt de bezorgstatus terug: alleen bij een transactionele provider. */
export function deliveryFeedbackAvailable(): boolean {
  return env.MAIL_TRANSPORT === 'postmark' || env.MAIL_TRANSPORT === 'resend'
}
