import Link from 'next/link'
import { PenLine, CheckCircle2, ShieldCheck } from 'lucide-react'
import { prisma } from '@/lib/db'
import { requireOnboarded } from '@/lib/auth/session'
import { currentSigners } from '@/lib/signflow'
import { documentsAwaitingSignature } from '@/lib/csc/flow'
import { formatDateTime } from '@/lib/utils'

export const dynamic = 'force-dynamic'

export default async function TeOndertekenenPage() {
  const me = await requireOnboarded()
  const mine = await prisma.recipient.findMany({
    where: { accountantId: me.id, status: 'PENDING', dossier: { status: { in: ['VERZONDEN', 'GEDEELTELIJK'] } } },
    include: { dossier: { include: { recipients: true, owner: { select: { name: true } } } } }
  })
  // Alleen tonen waar ik nú aan de beurt ben.
  const waiting = mine.filter((r) => currentSigners(r.dossier, r.dossier.recipients).some((a) => a.id === r.id))

  // Stukken die op de gekwalificeerde handtekening met beroepscertificaat wachten.
  const waarmerken = await documentsAwaitingSignature(me.id)

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Te ondertekenen</h1>
        <p className="text-slate-500">Documenten die op uw handtekening wachten.</p>
      </header>

      {waarmerken.length > 0 && (
        <Link
          href="/te-ondertekenen/waarmerken"
          className="flex items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4 text-sm text-indigo-900 transition hover:shadow-pop"
        >
          <span>
            <span className="block font-medium">
              {waarmerken.length === 1
                ? '1 stuk wacht op uw handtekening als accountant'
                : `${waarmerken.length} stukken wachten op uw handtekening als accountant`}
            </span>
            <span className="block text-indigo-800">
              Alle partijen hebben getekend. U bevestigt in één keer met uw pincode.
            </span>
          </span>
          <span className="btn-primary shrink-0 text-sm">
            <ShieldCheck className="h-4 w-4" /> Ondertekenen
          </span>
        </Link>
      )}

      {waiting.length === 0 ? (
        <div className="card flex flex-col items-center gap-2 p-12 text-center text-slate-500">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <p>U hoeft op dit moment niets te ondertekenen.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {waiting.map((r) => (
            <Link
              key={r.id}
              href={`/te-ondertekenen/${r.id}`}
              className="card flex items-center justify-between p-4 transition hover:shadow-pop"
            >
              <div>
                <div className="font-medium">{r.dossier.title}</div>
                <div className="text-xs text-slate-400">
                  Aangeboden door {r.dossier.owner.name} · {formatDateTime(r.dossier.sentAt)}
                </div>
              </div>
              <span className="btn-primary text-sm">
                <PenLine className="h-4 w-4" /> Ondertekenen
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
