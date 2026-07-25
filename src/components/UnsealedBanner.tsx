import { ShieldOff } from 'lucide-react'
import { sealEnabled } from '@/lib/seal/sealer'

// Staat de cryptografische verzegeling uit, dan mag dat niet onopgemerkt blijven.
// Het portaal blijft werken, maar verzonden documenten missen het digitale zegel
// en zijn dus niet automatisch door een PDF-lezer te controleren.
export function UnsealedBanner({ scope }: { scope: 'dashboard' | 'dossier' }) {
  if (sealEnabled()) return null
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-medium">
        <ShieldOff className="h-4 w-4" />
        Verzegeling staat uit. Verzonden documenten zijn niet cryptografisch beschermd.
      </p>
      <p className="mt-1 text-amber-800">
        {scope === 'dossier'
          ? 'Dit document krijgt geen digitaal zegel. Het ondertekencertificaat vermeldt dat, en de echtheid is niet automatisch door een PDF-lezer te controleren.'
          : 'Documenten krijgen alleen een auditcertificaat met vingerafdruk, geen digitaal zegel. Zet SEAL_MODE=sealer aan zodra het ondertekencertificaat beschikbaar is.'}
      </p>
    </div>
  )
}
