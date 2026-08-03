import { NextResponse, type NextRequest } from 'next/server'
import { prisma } from '@/lib/db'
import { getCurrentAccountant } from '@/lib/auth/session'

// Zoek-API voor de autocomplete van ontvangers. Alleen voor ingelogde staff.
export async function GET(req: NextRequest) {
  const acc = await getCurrentAccountant()
  if (!acc) return NextResponse.json({ error: 'Niet ingelogd' }, { status: 401 })

  const q = (req.nextUrl.searchParams.get('q') ?? '').trim()
  const clients = await prisma.client.findMany({
    where: {
      active: true,
      ...(q
        ? {
            OR: [
              { displayName: { contains: q, mode: 'insensitive' } },
              { companyName: { contains: q, mode: 'insensitive' } },
              { contactName: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } }
            ]
          }
        : {})
    },
    orderBy: { displayName: 'asc' },
    take: 20,
    select: {
      id: true,
      displayName: true,
      companyName: true,
      contactName: true,
      email: true,
      phone: true,
      verificationMethod: true
    }
  })
  return NextResponse.json({ clients })
}
