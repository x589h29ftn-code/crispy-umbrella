import 'server-only'
import nodemailer, { type Transporter } from 'nodemailer'
import { env } from '@/env'

// Env-gedreven e-mailtransport. Standaard Microsoft 365 SMTP; later
// omschakelbaar naar Postmark/Resend via MAIL_TRANSPORT zonder codewijziging
// bij de aanroepers.

let cached: Transporter | null = null

function build(): Transporter {
  switch (env.MAIL_TRANSPORT) {
    case 'smtp':
    default:
      return nodemailer.createTransport({
        host: env.SMTP_HOST,
        port: env.SMTP_PORT ?? 587,
        secure: env.SMTP_SECURE ?? false, // false = STARTTLS op 587
        auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
        requireTLS: true
      })
  }
}

export function mailer(): Transporter {
  if (!cached) cached = build()
  return cached
}

export interface MailMessage {
  to: string
  subject: string
  html: string
  text: string
  attachments?: { filename: string; content: Buffer }[]
}

export async function sendMail(msg: MailMessage): Promise<void> {
  const transporter = mailer()
  await transporter.sendMail({
    from: env.MAIL_FROM,
    to: msg.to,
    subject: msg.subject,
    text: msg.text,
    html: msg.html,
    attachments: msg.attachments
  })
}
