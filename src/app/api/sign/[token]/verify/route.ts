import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveToken } from '@/lib/signflow'
import { hashOtp, safeEqualHash } from '@/lib/auth/signingToken'
import { otpVerifySchema } from '@/lib/validation/schemas'
import { consume } from '@/lib/ratelimit'
import { writeAudit } from '@/lib/audit'
import { reqContext } from '@/lib/reqctx'
import { sendMail } from '@/lib/email/transport'

const MAX_ATTEMPTS = 5

/** Laat de dossiereigenaar weten dat de verificatie van een ontvanger vastloopt. */
async function notifyOwnerOtpBlocked(dossierId: string, name: string, email: string): Promise<void> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: dossierId },
    select: { title: true, owner: { select: { email: true } } }
  })
  if (!dossier) return
  await sendMail({
    to: dossier.owner.email,
    subject: `Verificatie vastgelopen: ${dossier.title}`,
    text:
      `${name} (${email}) heeft de verificatiecode voor "${dossier.title}" te vaak onjuist ingevoerd.\n` +
      `De ontvanger kan een nieuwe code aanvragen. Neem eventueel contact op om te controleren of het ` +
      `e-mailadres klopt.`,
    html:
      `<p><strong>${name}</strong> (${email}) heeft de verificatiecode voor <strong>${dossier.title}</strong> ` +
      `te vaak onjuist ingevoerd.</p><p>De ontvanger kan een nieuwe code aanvragen. Neem eventueel contact op ` +
      `om te controleren of het e-mailadres klopt.</p>`
  }).catch((e) => console.error('[otp geblokkeerd mail]', e))
}

// Verifieert de 6-cijferige e-mailcode.
export async function POST(req: NextRequest, { params }: { params: { token: string } }) {
  if (!(await consume('token', reqContext(req).ip ?? 'onbekend'))) {
    return NextResponse.json({ error: 'Te veel verzoeken. Probeer het later opnieuw.' }, { status: 429 })
  }
  const resolved = await resolveToken(params.token)
  if (!resolved.ok) return NextResponse.json({ error: 'Deze tekenlink is niet (meer) geldig.' }, { status: 410 })

  const body = await req.json().catch(() => ({}))
  const parsed = otpVerifySchema.safeParse(body)
  if (!parsed.success) return NextResponse.json({ error: 'Voer de 6-cijferige code in.' }, { status: 400 })

  const okRate = await consume('otpVerify', resolved.recipient.id)
  if (!okRate) return NextResponse.json({ error: 'Te veel pogingen. Vraag een nieuwe code aan.' }, { status: 429 })

  const r = resolved.recipient
  if (!r.otpHash || !r.otpExpiresAt || r.otpExpiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: 'De code is verlopen. Vraag een nieuwe aan.' }, { status: 400 })
  }
  if (r.otpAttempts >= MAX_ATTEMPTS) {
    await prisma.recipient.update({ where: { id: r.id }, data: { otpHash: null } })
    await writeAudit({
      type: 'OTP_GEBLOKKEERD',
      dossierId: resolved.dossier.id,
      recipientId: r.id,
      metadata: { attempts: r.otpAttempts, max: MAX_ATTEMPTS },
      ...reqContext(req)
    })
    await notifyOwnerOtpBlocked(resolved.dossier.id, r.name, r.email)
    return NextResponse.json({ error: 'Te veel foute pogingen. Vraag een nieuwe code aan.' }, { status: 429 })
  }

  if (!safeEqualHash(hashOtp(parsed.data.code), r.otpHash)) {
    const updated = await prisma.recipient.update({
      where: { id: r.id },
      data: { otpAttempts: { increment: 1 } },
      select: { otpAttempts: true }
    })
    // Het patroon van pogingen is bewijsmateriaal: vijf mislukte pogingen uit een
    // ander land gevolgd door een geslaagde is een ander verhaal dan één keer goed.
    await writeAudit({
      type: 'OTP_MISLUKT',
      dossierId: resolved.dossier.id,
      recipientId: r.id,
      metadata: { attempt: updated.otpAttempts, remaining: Math.max(0, MAX_ATTEMPTS - updated.otpAttempts) },
      ...reqContext(req)
    })
    if (updated.otpAttempts >= MAX_ATTEMPTS) {
      await writeAudit({
        type: 'OTP_GEBLOKKEERD',
        dossierId: resolved.dossier.id,
        recipientId: r.id,
        metadata: { attempts: updated.otpAttempts, max: MAX_ATTEMPTS },
        ...reqContext(req)
      })
      await notifyOwnerOtpBlocked(resolved.dossier.id, r.name, r.email)
    }
    return NextResponse.json({ error: 'Onjuiste code.' }, { status: 400 })
  }

  await prisma.recipient.update({
    where: { id: r.id },
    data: { otpVerifiedAt: new Date(), otpHash: null }
  })
  await writeAudit({
    type: 'OTP_GEVERIFIEERD',
    dossierId: resolved.dossier.id,
    recipientId: r.id,
    ...reqContext(req)
  })
  return NextResponse.json({ ok: true })
}
