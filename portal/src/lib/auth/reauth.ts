import 'server-only'
import { prisma } from '@/lib/db'
import { decryptTotpSecret, verifyTotpStep } from '@/lib/auth/totp'
import { writeAudit } from '@/lib/audit'

// Herverificatie op het ondertekenmoment (C.2 uit changeset v1.7).
//
// Een sessie leeft uren. Wie langsloopt bij een onvergrendelde laptop kan een
// stuk ondertekenen namens de accountant die is ingelogd. Dat is de enige echte
// zwakte in een opzet waarin de kantoorondertekenaar een gewone ontvanger is,
// en hij is niet met een kortere sessie op te lossen zonder het werken onwerkbaar
// te maken.
//
// Daarom vraagt het indienen van een ZELF-ondertekening om een verse TOTP-code.
// Bewust NIET om het wachtwoord: dat vullen browsers in, en dan bewijs je niets
// over het moment.

/** Vijf misslagen blokkeren déze ondertekening — nooit het account zelf. */
export const MAX_HERVERIFICATIE_POGINGEN = 5

export type ReauthReden = 'geen-2fa' | 'geblokkeerd' | 'ongeldig' | 'hergebruik'

export type ReauthResultaat = { ok: true } | { ok: false; reden: ReauthReden; melding: string }

/**
 * Controleert een verse TOTP-code voor het ondertekenen door een kantoorgebruiker.
 *
 * Bij succes wordt de gebruikte tijdstap vastgelegd op de accountant, zodat
 * dezelfde code niet nogmaals werkt — niet bij een tweede ondertekening en ook
 * niet bij het inloggen.
 */
export async function herverifieerVoorOndertekenen(input: {
  accountantId: string
  recipientId: string
  dossierId: string
  code: string
  ctx: { ip?: string; userAgent?: string }
}): Promise<ReauthResultaat> {
  const { accountantId, recipientId, dossierId, code, ctx } = input

  const acc = await prisma.accountant.findUnique({
    where: { id: accountantId },
    select: { totpEnabled: true, totpSecret: true }
  })
  // Hoort niet te kunnen: bij het aanmaken van het dossier is al gecontroleerd
  // dat een ZELF-ontvanger tweefactorauthenticatie aan heeft staan. Als het toch
  // gebeurt (2FA later uitgezet), dan liever weigeren dan overslaan.
  if (!acc?.totpEnabled || !acc.totpSecret) {
    return {
      ok: false,
      reden: 'geen-2fa',
      melding:
        'Voor ondertekenen is tweefactorauthenticatie vereist. Zet die aan onder Instellingen en probeer opnieuw.'
    }
  }

  const rec = await prisma.recipient.findUnique({
    where: { id: recipientId },
    select: { reauthAttempts: true }
  })
  if ((rec?.reauthAttempts ?? 0) >= MAX_HERVERIFICATIE_POGINGEN) {
    await writeAudit({
      type: 'HERVERIFICATIE_MISLUKT',
      dossierId,
      recipientId,
      accountantId,
      message: 'geblokkeerd na te veel pogingen',
      metadata: { pogingen: rec?.reauthAttempts ?? 0, max: MAX_HERVERIFICATIE_POGINGEN },
      ...ctx
    })
    return {
      ok: false,
      reden: 'geblokkeerd',
      melding:
        'Te veel onjuiste codes. Deze ondertekening is geblokkeerd; vraag een beheerder om hem vrij te geven. ' +
        'Uw account blijft gewoon werken.'
    }
  }

  const uitkomst = verifyTotpStep(decryptTotpSecret(acc.totpSecret), code)
  if (!uitkomst.ok || uitkomst.step === undefined) {
    const na = await prisma.recipient.update({
      where: { id: recipientId },
      data: { reauthAttempts: { increment: 1 } },
      select: { reauthAttempts: true }
    })
    await writeAudit({
      type: 'HERVERIFICATIE_MISLUKT',
      dossierId,
      recipientId,
      accountantId,
      message: 'onjuiste code',
      metadata: { poging: na.reauthAttempts, resterend: Math.max(0, MAX_HERVERIFICATIE_POGINGEN - na.reauthAttempts) },
      ...ctx
    })
    return { ok: false, reden: 'ongeldig', melding: 'Onjuiste code. Probeer het opnieuw.' }
  }

  // Voorwaardelijke update in plaats van eerst lezen en dan schrijven: twee
  // gelijktijdige indieningen met dezelfde code zouden anders allebei door de
  // controle komen. De database beslist wie de eerste was.
  const geclaimd = await prisma.accountant.updateMany({
    where: {
      id: accountantId,
      OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: uitkomst.step } }]
    },
    data: { lastTotpStep: uitkomst.step }
  })
  if (geclaimd.count === 0) {
    const na = await prisma.recipient.update({
      where: { id: recipientId },
      data: { reauthAttempts: { increment: 1 } },
      select: { reauthAttempts: true }
    })
    await writeAudit({
      type: 'HERVERIFICATIE_MISLUKT',
      dossierId,
      recipientId,
      accountantId,
      message: 'code al gebruikt (hergebruik binnen hetzelfde tijdvenster)',
      metadata: { poging: na.reauthAttempts, tijdstap: uitkomst.step },
      ...ctx
    })
    return {
      ok: false,
      reden: 'hergebruik',
      melding: 'Deze code is al gebruikt. Wacht op de volgende code in uw app en probeer opnieuw.'
    }
  }

  await prisma.recipient.update({
    where: { id: recipientId },
    data: { reauthAttempts: 0, reauthVerifiedAt: new Date() }
  })
  await writeAudit({
    type: 'HERVERIFICATIE_GESLAAGD',
    dossierId,
    recipientId,
    accountantId,
    message: 'verse code geaccepteerd bij ondertekenen',
    metadata: { tijdstap: uitkomst.step },
    ...ctx
  })
  return { ok: true }
}

/**
 * Claimt de tijdstap van een code die elders al is geverifieerd (inloggen,
 * 2FA-instellen). Zonder dit blijft een bij het inloggen gebruikte code binnen
 * hetzelfde venster nog bruikbaar om mee te ondertekenen, en dan is de
 * herverificatie een formaliteit in plaats van een controle.
 *
 * Geeft false als de stap al verbruikt was.
 */
export async function claimTotpStap(accountantId: string, step: number): Promise<boolean> {
  const res = await prisma.accountant.updateMany({
    where: { id: accountantId, OR: [{ lastTotpStep: null }, { lastTotpStep: { lt: step } }] },
    data: { lastTotpStep: step }
  })
  return res.count > 0
}
