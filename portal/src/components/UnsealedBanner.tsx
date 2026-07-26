import { ShieldOff } from 'lucide-react'
import type { AssuranceLevel } from '@prisma/client'
import { beschikbareNiveaus } from '@/lib/assurance'

// Twee verschillende dingen, en die niet door elkaar halen:
//
// Op het DASHBOARD is de vraag of de server überhaupt kan verzegelen. Kan hij dat
// niet, dan is dat een beheerskwestie en hoort er een melding te staan.
//
// Op een DOSSIER is de vraag wat er voor dít stuk is gekozen. Een server met een
// certificaat kan een stuk bewust zonder zegel versturen; dan is er niets mis,
// maar de afzender moet wel zien wat hij verstuurt. En omgekeerd: een dossier met
// een zegel hoort géén waarschuwing te krijgen omdat er ooit een globale vlag
// uitstond. Vandaar dat het dossier zijn eigen niveau meegeeft.
export function UnsealedBanner({ scope, niveau }: { scope: 'dashboard' | 'dossier'; niveau?: AssuranceLevel }) {
  if (scope === 'dossier') {
    if (niveau !== 'AUDITSPOOR') return null
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
        <p className="flex items-center gap-2 font-medium">
          <ShieldOff className="h-4 w-4" />
          Dit verzoek gaat zonder digitaal zegel de deur uit.
        </p>
        <p className="mt-1 text-amber-800">
          De bewijskracht zit in het auditspoor: verificatie per e-mail of sms, IP-adres, apparaat,
          tijdstippen en de gelezen verklaring, met een apart auditrapport na afronding. De ontvanger kan de
          echtheid niet in zijn PDF-lezer laten controleren.
        </p>
      </div>
    )
  }

  // Dashboard: alleen melden als de server geen enkel zegel kán zetten.
  if (beschikbareNiveaus().length > 1) return null
  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <p className="flex items-center gap-2 font-medium">
        <ShieldOff className="h-4 w-4" />
        Er is geen certificaat ingesteld; verzoeken gaan zonder digitaal zegel.
      </p>
      <p className="mt-1 text-amber-800">
        Documenten krijgen het ondertekencertificaat en een auditrapport, maar geen digitaal zegel. Zet
        <code className="mx-1">SEAL_MODE=organisation</code> aan zodra het organisatiecertificaat er is; dan
        is per verzoek te kiezen of het zegel wordt gebruikt.
      </p>
    </div>
  )
}
