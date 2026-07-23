import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { currentSigners } from '@/lib/signflow'
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
    select: { id: true, title: true }
  })

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">{dossier.title}</h1>
        <p className="text-slate-500">Controleer de documenten en plaats uw handtekening.</p>
      </header>
      <OfficeSign
        recipientId={recipient.id}
        dossierId={dossier.id}
        documents={documents}
        savedSignature={me.signaturePng}
        fields={recipient.fields.map((f) => ({ documentId: f.documentId, page: f.page, x: f.x, y: f.y, width: f.width, height: f.height }))}
      />
    </div>
  )
}
