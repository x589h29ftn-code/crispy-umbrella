import { NextResponse, type NextRequest } from 'next/server'
import { getCurrentAccountant } from '@/lib/auth/session'
import { completeQualifiedSigning } from '@/lib/csc/flow'

// Callback van de provider nadat de accountant in zijn app heeft bevestigd.
// Deze URL moet vooraf bij de provider geregistreerd zijn en stabiel blijven.
//
// Beveiliging: de state wordt in completeQualifiedSigning gevalideerd, én er
// wordt gecontroleerd of de sessie bij de ingelogde accountant hoort. Zonder die
// tweede controle zou iemand anders een callback kunnen afvangen.

export const dynamic = 'force-dynamic'

function back(url: URL, params: Record<string, string>): NextResponse {
  const target = new URL('/te-ondertekenen/waarmerken', url.origin)
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v)
  return NextResponse.redirect(target)
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl
  const acc = await getCurrentAccountant()
  if (!acc) {
    // Sessie verlopen tijdens het bevestigen: eerst opnieuw inloggen.
    const login = new URL('/login', url.origin)
    login.searchParams.set('next', '/te-ondertekenen/waarmerken')
    return NextResponse.redirect(login)
  }

  const error = url.searchParams.get('error')
  if (error) {
    const desc = url.searchParams.get('error_description') ?? error
    return back(url, { fout: `Bevestiging afgebroken: ${desc}`.slice(0, 300) })
  }

  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!code || !state) return back(url, { fout: 'De bevestiging was onvolledig. Probeer het opnieuw.' })

  const result = await completeQualifiedSigning({ code, state, accountantId: acc.id })
  if (!result.ok) return back(url, { fout: result.error })
  return back(url, { gereed: String(result.documentCount) })
}
