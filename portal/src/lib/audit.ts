import { prisma } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export type AuditType =
  | 'AANGEMAAKT'
  | 'VERZONDEN'
  | 'GEOPEND'
  | 'OTP_VERSTUURD'
  | 'OTP_GEVERIFIEERD'
  | 'ONDERTEKEND'
  | 'GEWEIGERD'
  | 'HERINNERD'
  | 'VERLOPEN'
  | 'VERZEGELD'
  | 'GEDOWNLOAD'
  | 'INGETROKKEN'
  | 'INGELOGD'
  | 'GEARCHIVEERD'

export interface AuditInput {
  type: AuditType
  dossierId?: string
  accountantId?: string
  recipientId?: string
  message?: string
  ip?: string
  userAgent?: string
  metadata?: Prisma.InputJsonValue
}

/** Schrijft één append-only auditregel. Faalt stil (mag de flow nooit blokkeren). */
export async function writeAudit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditEvent.create({
      data: {
        type: input.type,
        dossierId: input.dossierId,
        accountantId: input.accountantId,
        recipientId: input.recipientId,
        message: input.message,
        ipAddress: input.ip,
        userAgent: input.userAgent,
        metadata: input.metadata
      }
    })
  } catch (e) {
    console.error('[audit] kon auditregel niet schrijven', e)
  }
}
