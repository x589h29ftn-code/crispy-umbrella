import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccountant } from '@/lib/auth/session'

// Lijst van actieve kantoorgebruikers (voor de ondertekenaars in een workflow).
export async function GET() {
  const acc = await getCurrentAccountant()
  if (!acc) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })
  const accountants = await prisma.accountant.findMany({
    where: { active: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, email: true }
  })
  return NextResponse.json({ accountants })
}
