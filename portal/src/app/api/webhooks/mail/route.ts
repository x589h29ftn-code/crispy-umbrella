import { NextResponse, type NextRequest } from 'next/server'
import { env } from '@/env'
import { clientIp } from '@/lib/ip'
import {
  ipAllowed,
  normalisePostmark,
  normaliseResend,
  verifyBasicAuth,
  verifySvixSignature
} from '@/lib/email/webhook'
import { processMailEvent } from '@/lib/email/status'

// Terugkoppeling van de mailprovider: afgeleverd, gebounced, spamklacht, geopend.
//
// Onverifieerbare calls worden geweigerd. Zonder die controle zou iedereen
// bezorgstatussen in ons bewijsdossier kunnen schrijven.

export const dynamic = 'force-dynamic'

const MAX_BODY = 1_000_000

export async function POST(req: NextRequest) {
  const raw = await req.text()
  if (raw.length > MAX_BODY) {
    return NextResponse.json({ error: 'payload te groot' }, { status: 413 })
  }

  const provider = env.MAIL_TRANSPORT
  if (provider !== 'postmark' && provider !== 'resend') {
    return NextResponse.json({ error: 'geen transactionele mailprovider ingesteld' }, { status: 404 })
  }

  // --- Authenticiteit ---
  if (provider === 'postmark') {
    const ip = clientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'), env.TRUSTED_PROXY_HOPS)
    if (!ipAllowed(ip)) {
      console.warn('[mail webhook] geweigerd op IP', ip)
      return NextResponse.json({ error: 'niet toegestaan' }, { status: 403 })
    }
    if (!verifyBasicAuth(req.headers.get('authorization'))) {
      return NextResponse.json({ error: 'niet geautoriseerd' }, { status: 401 })
    }
  } else {
    const okSig = verifySvixSignature({
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
      body: raw
    })
    if (!okSig) {
      return NextResponse.json({ error: 'signatuur ongeldig' }, { status: 401 })
    }
  }

  // --- Inhoud ---
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'geen geldige JSON' }, { status: 400 })
  }

  const event =
    provider === 'postmark'
      ? normalisePostmark(payload)
      : normaliseResend(payload, req.headers.get('svix-id'))

  // Onbekend of niet-relevant type: netjes bevestigen, anders blijft de provider
  // het eindeloos opnieuw aanbieden.
  if (!event) return NextResponse.json({ ok: true, ignored: true })

  try {
    const result = await processMailEvent(provider, event, payload)
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    console.error('[mail webhook]', e)
    // 500 zodat de provider het opnieuw aanbiedt.
    return NextResponse.json({ error: 'verwerken mislukt' }, { status: 500 })
  }
}
