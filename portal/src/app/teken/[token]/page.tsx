import { ShieldAlert } from 'lucide-react'
import { headers } from 'next/headers'
import { prisma } from '@/lib/db'
import { resolveToken } from '@/lib/signflow'
import { writeAudit } from '@/lib/audit'
import { consume } from '@/lib/ratelimit'
import { storage } from '@/lib/storage'
import { sha256Hex } from '@/lib/seal/sealer'
import { CONSENT_TEXT, consentHash } from '@/lib/consent'
import { SignFlow } from './SignFlow'

export const dynamic = 'force-dynamic'

export default async function TekenPage({ params }: { params: { token: string } }) {
  const ip = headers().get('x-forwarded-for')?.split(',')[0]?.trim() || headers().get('x-real-ip') || 'onbekend'
  const withinLimit = await consume('token', ip)

  const resolved = withinLimit ? await resolveToken(params.token) : { ok: false as const, reason: 'onbekend' as const }

  if (!resolved.ok) {
    const messages: Record<string, string> = {
      onbekend: withinLimit ? 'Deze tekenlink is ongeldig.' : 'Te veel verzoeken. Probeer het over enkele minuten opnieuw.',
      verlopen: 'Deze tekenlink is verlopen. Vraag de afzender om een nieuwe.',
      gebruikt: 'Dit document is al ondertekend of de link is al gebruikt.',
      afgerond: 'Dit ondertekenverzoek is niet meer actief.'
    }
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="card max-w-md p-8 text-center">
          <ShieldAlert className="mx-auto mb-3 h-10 w-10 text-amber-500" />
          <h1 className="mb-1 text-lg font-semibold">Link niet beschikbaar</h1>
          <p className="text-slate-500">{messages[resolved.reason]}</p>
        </div>
      </main>
    )
  }

  const { recipient, dossier } = resolved

  // Registreer het openen éénmalig in het auditspoor.
  const alreadyOpened = await prisma.auditEvent.count({
    where: { dossierId: dossier.id, recipientId: recipient.id, type: 'GEOPEND' }
  })
  if (alreadyOpened === 0) {
    await writeAudit({ type: 'GEOPEND', dossierId: dossier.id, recipientId: recipient.id, message: recipient.email })
  }

  const fields = await prisma.signatureField.findMany({
    where: { dossierId: dossier.id, recipientId: recipient.id },
    select: { documentId: true, page: true, x: true, y: true, width: true, height: true }
  })
  // Alleen de documenten waarop deze ondertekenaar een tekenvak heeft.
  const docIds = Array.from(new Set(fields.map((f) => f.documentId)))
  const documents = await prisma.document.findMany({
    where: { id: { in: docIds } },
    orderBy: { order: 'asc' },
    select: { id: true, title: true, workingKey: true }
  })

  // Vastleggen wát deze ondertekenaar te zien krijgt: de letterlijke verklaring
  // en de hash van de documentbytes op dít moment. Bij één-voor-één ondertekenen
  // ziet de tweede ondertekenaar andere bytes dan de eerste, en dat is per
  // persoon aantoonbaar. Eenmalig, bij de eerste keer openen.
  if (!recipient.presentedAt || !recipient.consentShownAt) {
    const presented: Record<string, string> = {}
    const store = storage()
    for (const doc of documents) {
      if (!doc.workingKey) continue
      try {
        presented[doc.id] = sha256Hex(await store.get(doc.workingKey))
      } catch (e) {
        console.error('[teken] kon getoonde hash niet bepalen', e)
      }
    }
    await prisma.recipient.update({
      where: { id: recipient.id },
      data: {
        consentTextSnapshot: recipient.consentTextSnapshot ?? CONSENT_TEXT,
        consentTextHash: recipient.consentTextHash ?? consentHash(CONSENT_TEXT),
        consentShownAt: recipient.consentShownAt ?? new Date(),
        presentedHashes: recipient.presentedAt ? undefined : presented,
        presentedAt: recipient.presentedAt ?? new Date()
      }
    })
  }

  return (
    <main className="min-h-screen bg-slate-100 py-8">
      <div className="px-4">
        <SignFlow
          token={params.token}
          recipientName={recipient.name}
          dossierTitle={dossier.title}
          documents={documents.map((d) => ({ id: d.id, title: d.title }))}
          fields={fields}
          consentText={recipient.consentTextSnapshot ?? CONSENT_TEXT}
        />
      </div>
    </main>
  )
}
