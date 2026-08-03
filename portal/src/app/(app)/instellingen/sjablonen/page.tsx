import type { DocumentKind } from '@prisma/client'
import { requireBeheerder } from '@/lib/auth/session'
import { prisma } from '@/lib/db'
import { DEFAULT_TEMPLATES, KIND_LABELS, PLACEHOLDERS } from '@/lib/docanalyze/templates'
import { TemplateEditor } from './TemplateEditor'

const KINDS: DocumentKind[] = [
  'JAARREKENING',
  'NOTULEN_AVA',
  'BEVESTIGING_JAARREKENING',
  'AKKOORD_IB',
  'AKKOORD_VPB',
  'OPDRACHTBEVESTIGING'
]

export default async function SjablonenPage() {
  await requireBeheerder()
  const custom = await prisma.messageTemplate.findMany()
  const byKind = new Map(custom.map((t) => [t.kind, t]))

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Berichtsjablonen</h1>
        <p className="text-slate-500">
          De standaardtitel en -tekst per documenttype. Bij het uploaden van een document wordt het type herkend en
          vult het portaal deze teksten automatisch voor.
        </p>
      </header>

      <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
        <p className="mb-1 font-medium text-slate-700">Invulvelden</p>
        <ul className="space-y-0.5">
          {PLACEHOLDERS.map((p) => (
            <li key={p.token}>
              <span className="font-mono text-xs text-brand-700">{p.token}</span> — {p.uitleg}
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-4">
        {KINDS.map((kind) => {
          const row = byKind.get(kind)
          return (
            <TemplateEditor
              key={kind}
              kind={kind}
              label={KIND_LABELS[kind]}
              title={row?.titleTemplate ?? DEFAULT_TEMPLATES[kind].title}
              body={row?.bodyTemplate ?? DEFAULT_TEMPLATES[kind].body}
              isCustom={!!row}
            />
          )
        })}
      </div>
    </div>
  )
}
