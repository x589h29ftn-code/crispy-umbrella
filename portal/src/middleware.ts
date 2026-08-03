import { NextResponse, type NextRequest } from 'next/server'

// Middleware draait op de Edge-runtime: hier géén database. We doen twee dingen:
//  1) strikte security-headers + nonce-gebaseerde CSP op elke pagina;
//  2) een grove toegangspoort (redirect naar /login als de sessiecookie
//     ontbreekt). De echte sessievalidatie gebeurt server-side in de pagina's.

// /valideren staat hier bewust bij: de controlepagina haalt een geüploade PDF door
// een parser, en dat hoort geen onbeauthenticeerde ingang te zijn. Sinds v1.4 is dat
// ook geen verlies: met een gekwalificeerd certificaat van een QTSP op de
// EU-vertrouwenslijst toont Acrobat Reader zelf een geldige handtekening met de naam
// van de ondertekenaar. Een bank of cliënt heeft onze pagina dus niet nodig.
const PROTECTED = ['/dashboard', '/dossiers', '/klanten', '/instellingen', '/valideren', '/te-ondertekenen']
const SESSION_COOKIE = 'ovp_session'

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  // Toegangspoort voor beschermde delen.
  if (PROTECTED.some((p) => pathname === p || pathname.startsWith(p + '/'))) {
    if (!req.cookies.get(SESSION_COOKIE)) {
      const url = req.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString('base64')
  const isProd = process.env.NODE_ENV === 'production'
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isProd ? '' : "'unsafe-eval'"}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `font-src 'self' data:`,
    `worker-src 'self' blob:`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    isProd ? `upgrade-insecure-requests` : ''
  ]
    .filter(Boolean)
    .join('; ')

  const requestHeaders = new Headers(req.headers)
  requestHeaders.set('x-nonce', nonce)
  requestHeaders.set('content-security-policy', csp)

  const res = NextResponse.next({ request: { headers: requestHeaders } })
  res.headers.set('content-security-policy', csp)
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  if (isProd) {
    res.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload')
  }
  return res
}

export const config = {
  // Overal behalve statische assets en de pdf.js-worker.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|pdf.worker.min.mjs|logo-ovp.svg).*)']
}
