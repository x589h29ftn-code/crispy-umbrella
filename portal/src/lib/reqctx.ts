import type { NextRequest } from 'next/server'
import { clientIp } from '@/lib/ip'

/** Haalt IP en user-agent uit een inkomend verzoek (voor het auditspoor). */
export function reqContext(req: NextRequest): { ip?: string; userAgent?: string } {
  const ip = clientIp(req.headers.get('x-forwarded-for'), req.headers.get('x-real-ip'))
  const userAgent = req.headers.get('user-agent') || undefined
  return { ip, userAgent }
}
