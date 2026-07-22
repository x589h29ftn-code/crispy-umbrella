import 'server-only'
import { env } from '@/env'

// Sms-verzending via een configureerbare provider. Standaard uitgeschakeld
// (SMS_PROVIDER=none); alleen nodig als een cliënt sms-verificatie kiest.

/** Zet een Nederlands nummer om naar internationaal formaat (best-effort). */
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[^\d+]/g, '')
  if (p.startsWith('00')) p = '+' + p.slice(2)
  else if (p.startsWith('06')) p = '+31' + p.slice(1)
  else if (p.startsWith('0')) p = '+31' + p.slice(1)
  return p
}

export async function sendSms(to: string, text: string): Promise<void> {
  const number = normalizePhone(to)
  switch (env.SMS_PROVIDER) {
    case 'messagebird': {
      if (!env.MESSAGEBIRD_API_KEY) throw new Error('MESSAGEBIRD_API_KEY ontbreekt')
      const res = await fetch('https://rest.messagebird.com/messages', {
        method: 'POST',
        headers: {
          Authorization: `AccessKey ${env.MESSAGEBIRD_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ originator: env.SMS_ORIGINATOR || 'OttoVisser', recipients: [number], body: text })
      })
      if (!res.ok) throw new Error(`MessageBird-fout: ${res.status}`)
      return
    }
    case 'twilio': {
      if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN || !env.TWILIO_FROM) {
        throw new Error('Twilio-configuratie ontbreekt')
      }
      const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString('base64')
      const body = new URLSearchParams({ To: number, From: env.TWILIO_FROM, Body: text })
      const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`, {
        method: 'POST',
        headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      })
      if (!res.ok) throw new Error(`Twilio-fout: ${res.status}`)
      return
    }
    case 'none':
    default:
      throw new Error('Sms-verzending is niet geconfigureerd op de server.')
  }
}
