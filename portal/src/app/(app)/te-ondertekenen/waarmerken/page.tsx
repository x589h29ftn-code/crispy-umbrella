import Link from 'next/link'
import { CheckCircle2, ShieldAlert } from 'lucide-react'
import { requireOnboarded } from '@/lib/auth/session'
import { env } from '@/env'
import { documentsAwaitingSignature } from '@/lib/csc/flow'
import { WaarmerkForm } from './WaarmerkForm'

export const dynamic = 'force-dynamic'

export default async function WaarmerkenPage({
  searchParams
}: {
  searchParams: { fout?: string; gereed?: string }
}) {
  const me = await requireOnboarded()
  const documents = await documentsAwaitingSignature(me.id)
  const enabled = env.PROFESSIONAL_SIGNING_DRIVER === 'cleverbase'

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Ondertekenen met beroepscertificaat</h1>
        <p className="text-slate-500">
          Deze stukken zijn door alle partijen getekend en wachten op uw handtekening op persoonlijke titel.
        </p>
      </header>

      {searchParams.gereed && (
        <div className="flex items-start gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            {searchParams.gereed === '1'
              ? '1 document is ondertekend en afgerond.'
              : `${searchParams.gereed} documenten zijn ondertekend en afgerond.`}{' '}
            De betrokkenen ontvangen de definitieve versie per e-mail.
          </p>
        </div>
      )}
      {searchParams.fout && (
        <div className="flex items-start gap-3 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-900">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <p>{searchParams.fout}</p>
        </div>
      )}

      {!enabled ? (
        <div className="card p-6 text-sm text-slate-600">
          <p>
            Er is geen certificaatprovider ingesteld die om uw bevestiging vraagt. Stukken worden afgerond met de
            zichtbare stempels en het ondertekencertificaat.
          </p>
        </div>
      ) : !me.signingCertEnabled ? (
        <div className="card p-6 text-sm text-slate-600">
          <p>
            Voor uw account staat gekwalificeerd ondertekenen niet aan. Een beheerder kan dit instellen onder{' '}
            <Link href="/instellingen/gebruikers" className="underline">
              Instellingen &gt; Gebruikers
            </Link>
            .
          </p>
        </div>
      ) : documents.length === 0 ? (
        <div className="card p-6 text-sm text-slate-600">
          <p>Er wachten nu geen stukken op uw handtekening.</p>
          <Link href="/te-ondertekenen" className="mt-3 inline-block underline">
            Terug naar te ondertekenen
          </Link>
        </div>
      ) : (
        <>
          <p className="text-sm text-slate-600">
            Selecteer wat u wilt ondertekenen. U bevestigt daarna <strong>één keer</strong> met uw pincode, ook als het
            om meerdere stukken gaat.
          </p>
          <WaarmerkForm documents={documents} maxBatch={env.CLEVERBASE_MAX_BATCH} />
        </>
      )}
    </div>
  )
}
