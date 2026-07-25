import 'server-only'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { writeAudit } from '@/lib/audit'
import { sendMail } from '@/lib/email/transport'
import { reminderEmail, officeTurnEmail } from '@/lib/email/templates'
import { generateSigningToken } from '@/lib/auth/signingToken'

// De levensloop van een verzoek dat niet normaal afloopt: herinneren, verlopen,
// opnieuw versturen, en de eigenaar porren als een dossier op zijn waarmerk wacht.
//
// Het gedeelde besluit (changeset v1.2 punt 8, met de correctie uit v1.3):
//
//   - verzamelde handtekeningen en het volledige auditspoor blijven bewaard;
//   - er wordt NIETS verzegeld en er gaat GEEN voltooiingsmail uit bij een dossier
//     dat niet compleet is — een half ondertekend stuk is geen document;
//   - nog niet gebruikte tekentokens worden ingetrokken;
//   - de eigenaar krijgt bericht met de reden;
//   - GEWEIGERD is onherroepelijk: weigeren is een besluit, en opnieuw versturen is
//     een nieuw dossier;
//   - VERLOPEN is WEL opnieuw te versturen. De praktijk is "de cliënt was op
//     vakantie". Zou dat een nieuw dossier vereisen, dan zet iemand binnen een
//     maand de geldigheidsduur op een jaar en is de vervaltermijn feitelijk weg.

/** Op welke dagen na verzending er wordt herinnerd (besluit van het kantoor). */
export const HERINNER_DAGEN = [5, 12]
/** Een herinnering met een link die binnen een dag verloopt is erger dan geen. */
export const HERINNER_MARGE_MS = 24 * 60 * 60_000

/** Statussen waarin een verzoek nog op ondertekening wacht. */
const OPEN_STATUSSEN = ['VERZONDEN', 'GEDEELTELIJK'] as const

export interface ReminderResult {
  dossiers: number
  ontvangers: number
  overgeslagen: { dossierId: string; reason: string }[]
}

/**
 * Geeft de eerstvolgende herinnering die voor dit dossier nog open staat, of null.
 *
 * De termijnen zijn absoluut (dag 5 en 12), maar worden begrensd door de
 * geldigheidsduur: bij `linkTtlDays = 7` valt de tweede herinnering weg, want die
 * zou naar een link wijzen die al dood is.
 */
export function volgendeHerinnering(opts: {
  sentAt: Date | null
  expiresAt: Date | null
  remindersSent: number
  now: Date
}): { nummer: number; dag: number } | null {
  if (!opts.sentAt) return null
  const nummer = opts.remindersSent + 1
  const dag = HERINNER_DAGEN[opts.remindersSent]
  if (dag === undefined) return null
  const moment = opts.sentAt.getTime() + dag * 86_400_000
  if (opts.now.getTime() < moment) return null
  // De marge geldt vanaf NU en niet vanaf het geplande moment: een herinnering die
  // een dag te laat wordt verstuurd, gaat alsnog naar een link die morgen dood is.
  // Dan liever geen herinnering — een link die niet werkt is erger dan stilte.
  if (opts.expiresAt && opts.now.getTime() > opts.expiresAt.getTime() - HERINNER_MARGE_MS) return null
  return { nummer, dag }
}

/** Stuurt de herinneringen die vandaag aan de beurt zijn. */
export async function sendDueReminders(opts?: { now?: Date; limit?: number }): Promise<ReminderResult> {
  const now = opts?.now ?? new Date()
  const limit = opts?.limit ?? 100
  const result: ReminderResult = { dossiers: 0, ontvangers: 0, overgeslagen: [] }

  const kandidaten = await prisma.dossier.findMany({
    where: {
      status: { in: [...OPEN_STATUSSEN] },
      sentAt: { not: null },
      remindersSent: { lt: HERINNER_DAGEN.length }
    },
    orderBy: { sentAt: 'asc' },
    take: limit,
    include: { owner: { select: { name: true } }, recipients: true }
  })

  for (const dossier of kandidaten) {
    const due = volgendeHerinnering({
      sentAt: dossier.sentAt,
      expiresAt: dossier.expiresAt,
      remindersSent: dossier.remindersSent,
      now
    })
    if (!due) continue

    // Wie nog moet tekenen én bereikbaar is. Een gebouncet adres krijgt niets:
    // dat levert alleen meer bounces op.
    const teHerinneren = dossier.recipients.filter(
      (r) => r.status === 'PENDING' && r.mailStatus !== 'BOUNCED' && r.mailStatus !== 'COMPLAINED'
    )
    if (teHerinneren.length === 0) {
      // Niemand meer om te herinneren; teller toch bijwerken zodat we hier niet
      // elke ronde opnieuw langskomen.
      await prisma.dossier.update({
        where: { id: dossier.id },
        data: { remindersSent: due.nummer, lastReminderAt: now }
      })
      result.overgeslagen.push({ dossierId: dossier.id, reason: 'geen bereikbare ontvangers meer' })
      continue
    }

    const ttlMs = dossier.linkTtlDays * 24 * 60 * 60 * 1000
    let gelukt = 0
    for (const r of teHerinneren) {
      try {
        if (r.role === 'ZELF' && r.accountantId) {
          await sendMail({
            to: r.email,
            ...officeTurnEmail({
              recipientName: r.name,
              documentTitle: dossier.title,
              url: `${env.APP_URL}/te-ondertekenen`
            })
          })
        } else {
          // Nieuw token: van het oude bewaren we alleen de hash, dus de eerdere
          // link is niet opnieuw te versturen.
          const t = generateSigningToken()
          await prisma.recipient.update({
            where: { id: r.id },
            data: {
              tokenHash: t.hash,
              tokenExpiresAt: new Date(now.getTime() + ttlMs),
              tokenUsedAt: null,
              otpVerifiedAt: null,
              otpHash: null,
              otpExpiresAt: null
            }
          })
          await sendMail({
            to: r.email,
            ...reminderEmail({
              recipientName: r.name,
              senderName: dossier.owner.name,
              documentTitle: dossier.title,
              url: `${env.APP_URL}/teken/${t.raw}`
            })
          })
        }
        await writeAudit({
          type: 'HERINNERD',
          dossierId: dossier.id,
          recipientId: r.id,
          message: `automatische herinnering ${due.nummer} (dag ${due.dag}) naar ${r.email}`
        })
        result.ontvangers += 1
        gelukt += 1
      } catch (e) {
        console.error(`[herinnering] ${r.email} mislukt`, e)
        result.overgeslagen.push({ dossierId: dossier.id, reason: `${r.email}: ${(e as Error).message}` })
      }
    }

    // De teller alleen bijwerken als er ook echt iets is verstuurd. Zou hij altijd
    // oplopen, dan is een uur mailstoring genoeg om een herinnering definitief te
    // laten verdwijnen: hij staat als verstuurd geregistreerd en komt nooit terug.
    if (gelukt === 0) {
      result.overgeslagen.push({
        dossierId: dossier.id,
        reason: 'geen enkele herinnering verstuurd; volgende ronde opnieuw proberen'
      })
      continue
    }
    await prisma.dossier.update({
      where: { id: dossier.id },
      data: { remindersSent: due.nummer, lastReminderAt: now }
    })
    result.dossiers += 1
  }

  return result
}

export interface ExpireResult {
  dossiers: number
  tokensIngetrokken: number
}

/**
 * Zet verlopen dossiers op VERLOPEN, trekt ongebruikte tokens in en meldt het aan
 * de eigenaar.
 *
 * Voor de cliëntkant is dit niet strikt nodig — de tokencontrole ziet zelf dat een
 * link verlopen is. Deze taak is er voor de kantoorkant: de statuswijziging en het
 * bericht aan de eigenaar.
 */
export async function expireDueDossiers(opts?: { now?: Date; limit?: number }): Promise<ExpireResult> {
  const now = opts?.now ?? new Date()
  const limit = opts?.limit ?? 100
  const result: ExpireResult = { dossiers: 0, tokensIngetrokken: 0 }

  const verlopen = await prisma.dossier.findMany({
    where: { status: { in: [...OPEN_STATUSSEN] }, expiresAt: { not: null, lt: now } },
    orderBy: { expiresAt: 'asc' },
    take: limit,
    include: { owner: { select: { email: true, name: true } }, recipients: true }
  })

  for (const dossier of verlopen) {
    const open = dossier.recipients.filter((r) => r.status === 'PENDING')
    const getekend = dossier.recipients.filter((r) => r.status === 'SIGNED')

    await prisma.$transaction(async (tx) => {
      // Ongebruikte tokens intrekken. De handtekeningen die er al zijn blijven
      // staan: die zijn bewijs van wat er is gebeurd.
      await tx.recipient.updateMany({
        where: { dossierId: dossier.id, status: 'PENDING' },
        data: { tokenHash: null, tokenExpiresAt: null, otpHash: null, otpExpiresAt: null }
      })
      await tx.dossier.update({ where: { id: dossier.id }, data: { status: 'VERLOPEN' } })
    })
    result.tokensIngetrokken += open.length
    result.dossiers += 1

    await writeAudit({
      type: 'VERLOPEN',
      dossierId: dossier.id,
      message:
        `geldigheidsduur verstreken; ${open.length} tekenlink(s) ingetrokken, ` +
        `${getekend.length} handtekening(en) bewaard`
    })

    const namen = open.map((r) => `${r.name} <${r.email}>`).join(', ')
    await sendMail({
      to: dossier.owner.email,
      subject: `Verlopen: ${dossier.title}`,
      text:
        `Het ondertekenverzoek "${dossier.title}" is verlopen.\n\n` +
        `Nog niet ondertekend door: ${namen || 'niemand'}\n` +
        `Al ondertekend: ${getekend.length}\n\n` +
        `De al geplaatste handtekeningen en het bewijsdossier blijven bewaard. Er is niets ` +
        `verzegeld en er is geen voltooiingsmail verstuurd.\n\n` +
        `U kunt het verzoek opnieuw versturen zonder de documenten en velden opnieuw te doen: ` +
        `${env.APP_URL}/dossiers/${dossier.id}`,
      html:
        `<p>Het ondertekenverzoek <strong>${dossier.title}</strong> is verlopen.</p>` +
        `<p>Nog niet ondertekend door: ${namen || 'niemand'}<br>Al ondertekend: ${getekend.length}</p>` +
        `<p>De al geplaatste handtekeningen en het bewijsdossier blijven bewaard. Er is niets ` +
        `verzegeld en er is geen voltooiingsmail verstuurd.</p>` +
        `<p><a href="${env.APP_URL}/dossiers/${dossier.id}">Opnieuw versturen</a> kan zonder de ` +
        `documenten en velden opnieuw in te stellen.</p>`
    }).catch((e) => console.error('[verlopen mail]', e))
  }

  return result
}

/**
 * Verstuurt een VERLOPEN dossier opnieuw: nieuwe tokens, nieuwe vervaldatum,
 * herinneringen weer op nul. Zelfde dossier, dus het auditspoor blijft één keten.
 *
 * Alleen voor VERLOPEN. GEWEIGERD blijft onherroepelijk.
 */
export async function resendExpiredDossier(input: {
  dossierId: string
  accountantId: string
  reason?: string
  extraDays?: number
}): Promise<{ ok: true; ontvangers: number } | { ok: false; error: string }> {
  const dossier = await prisma.dossier.findUnique({
    where: { id: input.dossierId },
    include: { owner: { select: { name: true } }, recipients: true }
  })
  if (!dossier) return { ok: false, error: 'Dossier niet gevonden.' }
  if (dossier.status === 'GEWEIGERD') {
    return {
      ok: false,
      error:
        'Dit verzoek is geweigerd. Weigeren is een besluit; maak een nieuw dossier aan als u het ' +
        'opnieuw wilt aanbieden.'
    }
  }
  if (dossier.status !== 'VERLOPEN') {
    return { ok: false, error: 'Alleen een verlopen verzoek is opnieuw te versturen.' }
  }

  const openstaand = dossier.recipients.filter((r) => r.status === 'PENDING')
  if (openstaand.length === 0) {
    return { ok: false, error: 'Er is niemand meer die moet ondertekenen.' }
  }

  const dagen = input.extraDays ?? dossier.linkTtlDays
  const nieuwExpires = new Date(Date.now() + dagen * 86_400_000)
  const getekend = dossier.recipients.some((r) => r.status === 'SIGNED')

  await prisma.dossier.update({
    where: { id: dossier.id },
    data: {
      // Al iemand getekend? Dan is het gedeeltelijk, anders weer gewoon verzonden.
      status: getekend ? 'GEDEELTELIJK' : 'VERZONDEN',
      expiresAt: nieuwExpires,
      sentAt: new Date(),
      remindersSent: 0,
      lastReminderAt: null,
      resendCount: { increment: 1 }
    }
  })

  // Alleen wie nog niet had getekend krijgt een nieuwe link.
  const { activateSigner } = await import('@/lib/signflow')
  for (const r of openstaand) await activateSigner(r.id)

  await writeAudit({
    type: 'HERVERZONDEN',
    dossierId: dossier.id,
    accountantId: input.accountantId,
    message:
      `opnieuw verstuurd na verlopen (${openstaand.length} ontvanger(s), ` +
      `nieuwe geldigheid ${dagen} dagen)${input.reason ? `: ${input.reason}` : ''}`,
    metadata: { reason: input.reason ?? null, resendCount: dossier.resendCount + 1 }
  })

  return { ok: true, ontvangers: openstaand.length }
}

/** Na hoeveel werkdagen de eigenaar wordt gepord over een wachtend waarmerk. */
export const WAARMERK_NUDGE_DAGEN = 3

/**
 * Port de eigenaar over dossiers die op zijn gekwalificeerde handtekening wachten.
 *
 * Dit is het geval waarin de cliënt denkt dat hij klaar is en er niets gebeurt: de
 * cliënt heeft zijn deel gedaan, dus de nudge gaat naar het kantoor en niet naar
 * de cliënt.
 */
export async function nudgeWaitingSignatures(opts?: { now?: Date }): Promise<{ eigenaren: number; dossiers: number }> {
  const now = opts?.now ?? new Date()
  const grens = new Date(now.getTime() - WAARMERK_NUDGE_DAGEN * 86_400_000)

  const wachtend = await prisma.dossier.findMany({
    where: {
      status: 'WACHT_OP_WAARMERK',
      updatedAt: { lt: grens },
      OR: [{ lastWaarmerkNudgeAt: null }, { lastWaarmerkNudgeAt: { lt: grens } }]
    },
    select: { id: true, title: true, ownerId: true, owner: { select: { email: true, name: true } } }
  })
  if (wachtend.length === 0) return { eigenaren: 0, dossiers: 0 }

  const perEigenaar = new Map<string, { email: string; name: string; dossiers: { id: string; title: string }[] }>()
  for (const d of wachtend) {
    const entry = perEigenaar.get(d.ownerId) ?? { email: d.owner.email, name: d.owner.name, dossiers: [] }
    entry.dossiers.push({ id: d.id, title: d.title })
    perEigenaar.set(d.ownerId, entry)
  }

  for (const [, e] of perEigenaar) {
    const lijst = e.dossiers.map((d) => `- ${d.title} (${env.APP_URL}/dossiers/${d.id})`).join('\n')
    await sendMail({
      to: e.email,
      subject:
        e.dossiers.length === 1
          ? `Wacht op uw waarmerk: ${e.dossiers[0].title}`
          : `${e.dossiers.length} stukken wachten op uw waarmerk`,
      text:
        `Beste ${e.name},\n\n` +
        `De volgende stukken zijn door alle partijen ondertekend en wachten al langer dan ` +
        `${WAARMERK_NUDGE_DAGEN} dagen op uw handtekening als accountant:\n\n${lijst}\n\n` +
        `Zolang dat niet gebeurt is het dossier niet afgerond, terwijl de cliënt denkt dat hij ` +
        `klaar is. Bevestigen kan hier: ${env.APP_URL}/te-ondertekenen/waarmerken`,
      html:
        `<p>Beste ${e.name},</p><p>De volgende stukken zijn door alle partijen ondertekend en wachten ` +
        `al langer dan ${WAARMERK_NUDGE_DAGEN} dagen op uw handtekening als accountant:</p><ul>` +
        e.dossiers.map((d) => `<li><a href="${env.APP_URL}/dossiers/${d.id}">${d.title}</a></li>`).join('') +
        `</ul><p>Zolang dat niet gebeurt is het dossier niet afgerond, terwijl de cliënt denkt dat hij ` +
        `klaar is.</p><p><a href="${env.APP_URL}/te-ondertekenen/waarmerken">Nu bevestigen</a></p>`
    }).catch((e2) => console.error('[waarmerk nudge]', e2))
  }

  await prisma.dossier.updateMany({
    where: { id: { in: wachtend.map((d) => d.id) } },
    data: { lastWaarmerkNudgeAt: now }
  })
  for (const d of wachtend) {
    await writeAudit({
      type: 'HERINNERD',
      dossierId: d.id,
      message: `eigenaar gepord: wacht al langer dan ${WAARMERK_NUDGE_DAGEN} dagen op waarmerk`
    })
  }
  return { eigenaren: perEigenaar.size, dossiers: wachtend.length }
}
