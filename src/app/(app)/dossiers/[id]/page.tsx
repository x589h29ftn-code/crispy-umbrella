import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, PencilRuler, CheckCircle2, Clock, XCircle } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireAccountant } from '@/lib/auth/session'
import { StatusBadge } from '@/components/StatusBadge'
import { DossierActions } from './DossierActions'
import { PARTY_LABEL } from '@/lib/status'
import { formatDateTime } from '@/lib/utils'

const AUDIT_LABEL: Record<string, string> = {
  AANGEMAAKT: 'Dossier aangemaakt',
  VERZONDEN: 'Verzonden naar ontvanger',
  GEOPEND: 'Ontvanger opende het document',
  OTP_VERSTUURD: 'Verificatiecode verstuurd',
  OTP_GEVERIFIEERD: 'Identiteit geverifieerd',
  ONDERTEKEND: 'Ondertekend',
  GEWEIGERD: 'Ondertekening geweigerd',
  HERINNERD: 'Herinnering verstuurd',
  VERLOPEN: 'Verlopen',
  VERZEGELD: 'Definitief verzegeld',
  GEDOWNLOAD: 'Gedownload',
  INGETROKKEN: 'Ingetrokken'
}

export default async function DossierDetailPage({ params }: { params: { id: string } }) {
  const acc = await requireAccountant()
  const dossier = await prisma.dossier.findUnique({
    where: { id: params.id },
    include: {
      recipients: { orderBy: { order: 'asc' } },
      auditEvents: { orderBy: { createdAt: 'asc' } },
      owner: { select: { name: true } }
    }
  })
  if (!dossier) notFound()
  if (dossier.ownerId !== acc.id && acc.role !== 'BEHEERDER') notFound()

  const canDownload = !!dossier.sealedKey || !!dossier.workingKey

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold">{dossier.title}</h1>
            <StatusBadge status={dossier.status} />
          </div>
          <p className="text-slate-500">
            Aangemaakt {formatDateTime(dossier.createdAt)} door {dossier.owner.name}
          </p>
        </div>
        <div className="flex gap-2">
          {dossier.status === 'CONCEPT' && (
            <Link href={`/dossiers/${dossier.id}/voorbereiden`} className="btn-secondary">
              <PencilRuler className="h-4 w-4" /> Velden bewerken
            </Link>
          )}
          {canDownload && (
            <a href={`/api/dossiers/${dossier.id}/download`} className="btn-secondary">
              <Download className="h-4 w-4" /> Download PDF
            </a>
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-6">
            <h2 className="mb-4 text-lg font-semibold">Acties</h2>
            {dossier.status === 'CONCEPT' && dossier.recipients.length === 0 ? (
              <p className="text-sm text-slate-500">
                Nog geen ontvangers.{' '}
                <Link href={`/dossiers/${dossier.id}/voorbereiden`} className="font-medium text-brand-700 underline">
                  Plaats eerst tekenvelden en ontvangers
                </Link>
                .
              </p>
            ) : (
              <DossierActions dossierId={dossier.id} status={dossier.status} />
            )}
          </section>

          <section className="card p-6">
            <h2 className="mb-4 text-lg font-semibold">Ontvangers</h2>
            {dossier.recipients.length === 0 ? (
              <p className="text-sm text-slate-500">Nog geen ontvangers ingesteld.</p>
            ) : (
              <ul className="divide-y divide-slate-100">
                {dossier.recipients.map((r) => (
                  <li key={r.id} className="flex items-center justify-between py-3">
                    <div>
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-slate-400">{r.email}</div>
                    </div>
                    <div className="flex items-center gap-2 text-sm">
                      {r.status === 'SIGNED' ? (
                        <span className="inline-flex items-center gap-1 text-emerald-600">
                          <CheckCircle2 className="h-4 w-4" /> {PARTY_LABEL.SIGNED}
                          {r.signedAt && <span className="text-xs text-slate-400"> · {formatDateTime(r.signedAt)}</span>}
                        </span>
                      ) : r.status === 'DECLINED' ? (
                        <span className="inline-flex items-center gap-1 text-rose-600">
                          <XCircle className="h-4 w-4" /> {PARTY_LABEL.DECLINED}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600">
                          <Clock className="h-4 w-4" /> {PARTY_LABEL.PENDING}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <section className="card p-6">
          <h2 className="mb-4 text-lg font-semibold">Tijdlijn</h2>
          <ol className="relative space-y-4 border-l border-slate-200 pl-4">
            {dossier.auditEvents.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full bg-brand-500" />
                <div className="text-sm font-medium">{AUDIT_LABEL[e.type] ?? e.type}</div>
                {e.message && <div className="text-xs text-slate-400">{e.message}</div>}
                <div className="text-xs text-slate-400">{formatDateTime(e.createdAt)}</div>
              </li>
            ))}
            {dossier.auditEvents.length === 0 && <li className="text-sm text-slate-400">Nog geen gebeurtenissen.</li>}
          </ol>
        </section>
      </div>
    </div>
  )
}
