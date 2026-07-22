import type { NextRequest } from 'next/server'

/** Haalt IP en user-agent uit een inkomend verzoek (voor het auditspoor). */
export function reqContext(req: NextRequest): { ip?: string; userAgent?: string } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || undefined
  const userAgent = req.headers.get('user-agent') || undefined
  return { ip, userAgent }
}
