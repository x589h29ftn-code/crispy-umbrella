import type { DossierStatus } from '@prisma/client'
import { STATUS_LABEL, STATUS_STYLE } from '@/lib/status'
import { cn } from '@/lib/utils'

export function StatusBadge({ status }: { status: DossierStatus }) {
  return <span className={cn('badge', STATUS_STYLE[status])}>{STATUS_LABEL[status]}</span>
}
