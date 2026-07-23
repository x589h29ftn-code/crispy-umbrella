import { notFound, redirect } from 'next/navigation'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { FieldPlacer } from '@/components/FieldPlacer'

export default async function VoorbereidenPage({ params }: { params: { id: string } }) {
  const acc = await requireOnboarded()
  const dossier = await prisma.dossier.findUnique({ where: { id: params.id } })
  if (!dossier) notFound()
  if (dossier.ownerId !== acc.id && acc.role !== 'BEHEERDER') notFound()
  if (dossier.status !== 'CONCEPT') redirect(`/dossiers/${dossier.id}`)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Velden plaatsen</h1>
        <p className="text-slate-500">{dossier.title}</p>
      </header>
      <FieldPlacer dossierId={dossier.id} pdfUrl={`/api/dossiers/${dossier.id}/pdf`} />
    </div>
  )
}
