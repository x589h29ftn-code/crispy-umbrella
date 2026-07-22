import type { DossierStatus, PartyStatus, Recipient } from '@prisma/client'

export const STATUS_LABEL: Record<DossierStatus, string> = {
  CONCEPT: 'Concept',
  VERZONDEN: 'Verzonden',
  GEDEELTELIJK: 'Gedeeltelijk',
  ONDERTEKEND: 'Ondertekend',
  GEWEIGERD: 'Geweigerd',
  VERLOPEN: 'Verlopen'
}

export const PARTY_LABEL: Record<PartyStatus, string> = {
  PENDING: 'Nog niet getekend',
  SIGNED: 'Getekend',
  DECLINED: 'Geweigerd'
}

// Kleurklassen (Tailwind) voor statusbadges.
export const STATUS_STYLE: Record<DossierStatus, string> = {
  CONCEPT: 'bg-slate-100 text-slate-700 ring-slate-200',
  VERZONDEN: 'bg-amber-50 text-amber-700 ring-amber-200',
  GEDEELTELIJK: 'bg-blue-50 text-blue-700 ring-blue-200',
  ONDERTEKEND: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  GEWEIGERD: 'bg-rose-50 text-rose-700 ring-rose-200',
  VERLOPEN: 'bg-slate-100 text-slate-500 ring-slate-200'
}

/**
 * Herberekent de dossierstatus op basis van de partijen. Spiegelt het gedrag
 * van de desktop-app (recomputeStatus) en breidt uit met geweigerd/verlopen.
 */
export function recomputeStatus(
  current: DossierStatus,
  parties: Pick<Recipient, 'role' | 'status'>[],
  opts?: { expired?: boolean }
): DossierStatus {
  if (current === 'CONCEPT' && !opts?.expired) return 'CONCEPT'
  if (opts?.expired) return 'VERLOPEN'

  const external = parties.filter((p) => p.role === 'EXTERN')
  const relevant = parties // zowel ZELF als EXTERN tellen mee voor "alles getekend"

  if (external.some((p) => p.status === 'DECLINED')) return 'GEWEIGERD'
  if (relevant.length > 0 && relevant.every((p) => p.status === 'SIGNED')) return 'ONDERTEKEND'
  if (relevant.some((p) => p.status === 'SIGNED')) return 'GEDEELTELIJK'
  return 'VERZONDEN'
}
