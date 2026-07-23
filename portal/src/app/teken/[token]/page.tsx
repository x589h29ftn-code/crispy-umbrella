import { ShieldAlert } from 'lucide-react'
import { headers } from 'next/headers'
import { prisma } from '@/lib/db'
import { resolveToken } from '@/lib/signflow'
import { writeAudit } from '@/lib/audit'
import { consume } from '@/lib/ratelimit'
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
    select: { page: true, x: true, y: true, width: true, height: true }
  })

  return (
    <main className="min-h-screen bg-slate-100 py-8">
      <div className="px-4">
        <SignFlow token={params.token} recipientName={recipient.name} dossierTitle={dossier.title} fields={fields} />
      </div>
    </main>
  )
}
