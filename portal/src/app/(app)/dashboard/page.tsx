import Link from 'next/link'
import { Plus, FileText, Search, AlertTriangle, MailWarning } from 'lucide-react'
import type { DossierStatus, Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { StatusBadge } from '@/components/StatusBadge'
import { STATUS_LABEL } from '@/lib/status'
import { recipientsWithMailProblem } from '@/lib/email/status'
import { deliveryFeedbackAvailable } from '@/lib/email/transport'
import { formatDateTime } from '@/lib/utils'

const FILTERS: (DossierStatus | 'ALLE')[] = ['ALLE', 'CONCEPT', 'VERZONDEN', 'GEDEELTELIJK', 'ONDERTEKEND']
const OPEN_STATUSES: DossierStatus[] = ['VERZONDEN', 'GEDEELTELIJK']
const ATTENTION_DAYS = 3

// Toont de resterende geldigheid van een openstaand verzoek, met kleur.
function expiryInfo(status: DossierStatus, expiresAt: Date | null, now: number) {
  if (!expiresAt || !OPEN_STATUSES.includes(status)) return null
  const days = Math.ceil((expiresAt.getTime() - now) / 86_400_000)
  if (days < 0) return { text: 'Verlopen', cls: 'text-rose-600 font-medium' }
  if (days === 0) return { text: 'Verloopt vandaag', cls: 'text-rose-600 font-medium' }
  if (days <= ATTENTION_DAYS) return { text: `Nog ${days} ${days === 1 ? 'dag' : 'dagen'}`, cls: 'text-amber-600 font-medium' }
  return { text: `Nog ${days} dagen`, cls: 'text-slate-500' }
}

export default async function DashboardPage({
  searchParams
}: {
  searchParams: { status?: string; q?: string; aandacht?: string; nieuw?: string }
}) {
  const acc = await requireOnboarded()
  const isBeheerder = acc.role === 'BEHEERDER'
  const statusFilter = FILTERS.includes(searchParams.status as DossierStatus) ? (searchParams.status as DossierStatus) : null
  const q = searchParams.q?.trim() ?? ''
  const attention = searchParams.aandacht === '1'
  const now = Date.now()
  const soon = new Date(now + ATTENTION_DAYS * 86_400_000)

  const ownerScope: Prisma.DossierWhereInput = isBeheerder ? {} : { ownerId: acc.id }
  const search: Prisma.DossierWhereInput = q
    ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { recipients: { some: { name: { contains: q, mode: 'insensitive' } } } },
          { recipients: { some: { email: { contains: q, mode: 'insensitive' } } } }
        ]
      }
    : {}
  const attentionWhere: Prisma.DossierWhereInput = { status: { in: OPEN_STATUSES }, expiresAt: { lte: soon } }

  const where: Prisma.DossierWhereInput = {
    ...ownerScope,
    ...search,
    ...(attention ? attentionWhere : statusFilter ? { status: statusFilter } : {})
  }

  const [dossiers, counts, attentionCount, sealingFailed] = await Promise.all([
    prisma.dossier.findMany({
      where,
      orderBy: attention ? { expiresAt: 'asc' } : { createdAt: 'desc' },
      take: 100,
      include: { recipients: true, owner: { select: { name: true } } }
    }),
    prisma.dossier.groupBy({ by: ['status'], where: { ...ownerScope, ...search }, _count: true }),
    prisma.dossier.count({ where: { ...ownerScope, ...search, ...attentionWhere } }),
    // Volledig ondertekend, maar het digitale zegel ontbreekt nog. Hier gaat
    // bewust geen voltooiingsmail uit; een achtergrondtaak probeert het opnieuw.
    prisma.dossier.findMany({
      where: { ...ownerScope, status: 'SEALING_FAILED' },
      orderBy: { updatedAt: 'desc' },
      take: 10,
      select: { id: true, title: true, updatedAt: true }
    })
  ])
  // Ontvangers waarvan de mail niet aankomt: zonder signaal bloedt zo'n dossier
  // stil dood.
  const mailProblems = deliveryFeedbackAvailable() ? await recipientsWithMailProblem(acc.id, isBeheerder) : []
  // Laatste foutmelding per wachtend dossier, voor een bruikbare melding.
  const sealErrors = sealingFailed.length
    ? await prisma.auditEvent.findMany({
        where: { type: 'VERZEGELING_MISLUKT', dossierId: { in: sealingFailed.map((d) => d.id) } },
        orderBy: { createdAt: 'desc' },
        select: { dossierId: true, message: true, createdAt: true }
      })
    : []

  const countFor = (s: DossierStatus) => counts.find((c) => c.status === s)?._count ?? 0
  const linkWith = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    if (q) p.set('q', q)
    for (const [k, v] of Object.entries(extra)) if (v) p.set(k, v)
    const s = p.toString()
    return s ? `/dashboard?${s}` : '/dashboard'
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Dashboard</h1>
          <p className="text-slate-500">{isBeheerder ? 'Alle dossiers van het kantoor.' : 'Uw ondertekendossiers.'}</p>
        </div>
        <Link href="/dossiers/nieuw" className="btn-primary">
          <Plus className="h-4 w-4" /> Nieuw dossier
        </Link>
      </header>

      {sealingFailed.length > 0 && (
        <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 text-sm text-orange-900">
          <p className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4" />
            {sealingFailed.length === 1
              ? '1 dossier wacht op verzegeling'
              : `${sealingFailed.length} dossiers wachten op verzegeling`}
          </p>
          <p className="mt-1 text-orange-800">
            Deze dossiers zijn door alle partijen ondertekend, maar het digitale zegel ontbreekt nog. Er is nog geen
            voltooiingsmail verstuurd; het portaal probeert het automatisch opnieuw.
          </p>
          <ul className="mt-3 space-y-1">
            {sealingFailed.map((d) => {
              const last = sealErrors.find((e) => e.dossierId === d.id)
              return (
                <li key={d.id}>
                  <Link href={`/dossiers/${d.id}`} className="font-medium underline">
                    {d.title}
                  </Link>
                  {last && (
                    <span className="text-orange-800">
                      {' '}
                      — laatste poging{' '}
                      {last.createdAt.toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                      {last.message ? `: ${last.message.slice(0, 160)}` : ''}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {mailProblems.length > 0 && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <p className="flex items-center gap-2 font-medium">
            <MailWarning className="h-4 w-4" />
            {mailProblems.length === 1
              ? '1 uitnodiging komt niet aan'
              : `${mailProblems.length} uitnodigingen komen niet aan`}
          </p>
          <p className="mt-1 text-rose-800">
            Corrigeer het e-mailadres en verstuur het verzoek opnieuw. Er gaan geen herinneringen meer naar deze
            adressen.
          </p>
          <ul className="mt-3 space-y-1">
            {mailProblems.map((r) => (
              <li key={r.id}>
                <Link href={`/dossiers/${r.dossier.id}`} className="font-medium underline">
                  {r.dossier.title}
                </Link>{' '}
                — {r.name} &lt;{r.email}&gt;
                <span className="text-rose-800">
                  {r.mailStatus === 'COMPLAINED'
                    ? ' · als spam gemarkeerd'
                    : r.mailBounceReason
                      ? ` · ${r.mailBounceReason.slice(0, 120)}`
                      : ' · niet bezorgd'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {searchParams.nieuw === 'apart' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800">
          De losse verzoeken zijn als concept aangemaakt. Open ze hieronder om per stuk de tekenvelden te plaatsen en te
          versturen.
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const active = !attention && ((f === 'ALLE' && !statusFilter) || f === statusFilter)
            const label = f === 'ALLE' ? 'Alle' : STATUS_LABEL[f as DossierStatus]
            const count = f === 'ALLE' ? counts.reduce((a, c) => a + c._count, 0) : countFor(f as DossierStatus)
            return (
              <Link
                key={f}
                href={linkWith({ status: f === 'ALLE' ? undefined : f })}
                className={active ? 'btn-primary text-sm' : 'btn-secondary text-sm'}
              >
                {label} <span className="ml-1 opacity-70">{count}</span>
              </Link>
            )
          })}
          <Link
            href={linkWith({ aandacht: '1' })}
            className={
              attention
                ? 'btn-primary bg-amber-500 text-sm hover:bg-amber-600'
                : 'btn-secondary text-sm text-amber-700 ring-amber-200'
            }
          >
            <AlertTriangle className="h-4 w-4" /> Aandacht nodig <span className="ml-1 opacity-70">{attentionCount}</span>
          </Link>
        </div>

        <form action="/dashboard" method="get" className="flex items-center gap-2">
          {attention && <input type="hidden" name="aandacht" value="1" />}
          {statusFilter && !attention && <input type="hidden" name="status" value={statusFilter} />}
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              name="q"
              defaultValue={q}
              placeholder="Zoek op titel of ondertekenaar"
              className="input min-w-[240px] pl-8 text-sm"
            />
          </div>
          <button type="submit" className="btn-secondary text-sm">
            Zoeken
          </button>
        </form>
      </div>

      {(q || attention) && (
        <p className="text-sm text-slate-500">
          {attention ? 'Openstaande verzoeken die (bijna) verlopen' : `Resultaten voor "${q}"`}
          {' · '}
          <Link href="/dashboard" className="text-brand-700 hover:underline">
            wis filters
          </Link>
        </p>
      )}

      <div className="card overflow-hidden">
        {dossiers.length === 0 ? (
          <div className="flex flex-col items-center gap-2 p-12 text-center text-slate-500">
            <FileText className="h-8 w-8 text-slate-300" />
            <p>{q || attention ? 'Geen dossiers gevonden.' : 'Nog geen dossiers. Maak een nieuw ondertekendossier aan.'}</p>
          </div>
        ) : (
          <>
          <table className="hidden w-full text-sm md:table">
            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Titel</th>
                <th className="px-4 py-3">Ondertekenaars</th>
                {isBeheerder && <th className="px-4 py-3">Accountant</th>}
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Verloopt</th>
                <th className="px-4 py-3">Aangemaakt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {dossiers.map((d) => {
                const signed = d.recipients.filter((r) => r.status === 'SIGNED').length
                const exp = expiryInfo(d.status, d.expiresAt, now)
                return (
                  <tr key={d.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/dossiers/${d.id}`} className="font-medium text-brand-700 hover:underline">
                        {d.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {d.recipients.length > 0 ? `${signed}/${d.recipients.length} ondertekend` : '-'}
                    </td>
                    {isBeheerder && <td className="px-4 py-3 text-slate-600">{d.owner.name}</td>}
                    <td className="px-4 py-3">
                      <StatusBadge status={d.status} />
                    </td>
                    <td className="px-4 py-3">
                      {exp ? <span className={exp.cls}>{exp.text}</span> : <span className="text-slate-300">-</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(d.createdAt)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          {/* Kaartweergave op kleine schermen (telefoon) */}
          <ul className="divide-y divide-slate-100 md:hidden">
            {dossiers.map((d) => {
              const signed = d.recipients.filter((r) => r.status === 'SIGNED').length
              const exp = expiryInfo(d.status, d.expiresAt, now)
              return (
                <li key={d.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/dossiers/${d.id}`} className="font-medium text-brand-700 hover:underline">
                      {d.title}
                    </Link>
                    <StatusBadge status={d.status} />
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {d.recipients.length > 0 ? `${signed}/${d.recipients.length} ondertekend` : 'Geen ondertekenaars'}
                    {isBeheerder ? ` · ${d.owner.name}` : ''}
                  </div>
                  <div className="mt-1 flex items-center justify-between text-xs">
                    <span className={exp ? exp.cls : 'text-slate-400'}>{exp ? exp.text : ''}</span>
                    <span className="text-slate-400">{formatDateTime(d.createdAt)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          </>
        )}
      </div>
    </div>
  )
}
