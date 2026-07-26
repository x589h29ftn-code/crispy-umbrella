import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { currentSigners } from '@/lib/signflow'
import { storage } from '@/lib/storage'
import { sha256Hex } from '@/lib/seal/sealer'
import { consentTextVoor, consentHash } from '@/lib/consent'
import { OfficeSign } from './OfficeSign'

export const dynamic = 'force-dynamic'

export default async function OfficeSignPage({ params }: { params: { id: string } }) {
  const me = await requireOnboarded()
  const recipient = await prisma.recipient.findUnique({
    where: { id: params.id },
    include: { dossier: { include: { recipients: true } }, fields: true }
  })
  if (!recipient || recipient.accountantId !== me.id) notFound()
  const dossier = recipient.dossier
  if (recipient.status !== 'PENDING' || !['VERZONDEN', 'GEDEELTELIJK'].includes(dossier.status)) {
    redirect('/te-ondertekenen')
  }
  // Alleen als het nu mijn beurt is.
  const active = currentSigners(dossier, dossier.recipients)
  if (!active.some((a) => a.id === recipient.id)) redirect('/te-ondertekenen')

  const docIds = Array.from(new Set(recipient.fields.map((f) => f.documentId)))
  const documents = await prisma.document.findMany({
    where: { id: { in: docIds } },
    orderBy: { order: 'asc' },
    select: { id: true, title: true, workingKey: true, detectedKind: true }
  })

  // Dezelfde vastlegging als aan de cliëntkant (C.4 uit changeset v1.7). Was dit
  // er niet, dan is het auditspoor asymmetrisch: van de cliënt weet je precies
  // welke bytes hij zag en welke verklaring hij las, van de accountant niet.
  // Juist bij hem is de getoonde versie relevant, want hij ziet een document
  // waar de stempel van de cliënt al op staat.
  const verklaring = consentTextVoor('ZELF', documents[0]?.detectedKind ?? null)
  if (!recipient.presentedAt || !recipient.consentShownAt) {
    const presented: Record<string, string> = {}
    const store = storage()
    for (const doc of documents) {
      if (!doc.workingKey) continue
      try {
        presented[doc.id] = sha256Hex(await store.get(doc.workingKey))
      } catch (e) {
        console.error('[te-ondertekenen] kon getoonde hash niet bepalen', e)
      }
    }
    await prisma.recipient.update({
      where: { id: recipient.id },
      data: {
        consentTextSnapshot: recipient.consentTextSnapshot ?? verklaring,
        consentTextHash: recipient.consentTextHash ?? consentHash(verklaring),
        consentShownAt: recipient.consentShownAt ?? new Date(),
        presentedHashes: recipient.presentedAt ? undefined : presented,
        presentedAt: recipient.presentedAt ?? new Date()
      }
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{dossier.title}</h1>
        <p className="text-slate-500">Controleer de documenten en plaats uw handtekening.</p>
      </header>
      <OfficeSign
        recipientId={recipient.id}
        dossierId={dossier.id}
        documents={documents.map((d) => ({ id: d.id, title: d.title }))}
        consentText={recipient.consentTextSnapshot ?? verklaring}
        savedSignature={me.signaturePng}
        fields={recipient.fields.map((f) => ({ documentId: f.documentId, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height }))}
      />
    </div>
  )
}
