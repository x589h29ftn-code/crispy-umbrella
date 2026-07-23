import 'server-only'
import { cookies, headers } from 'next/headers'
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { redirect } from 'next/navigation'
import type { Accountant } from '@prisma/client'
import { prisma } from '@/lib/db'
import { env } from '@/env'

const SESSION_COOKIE = 'ovp_session'
const PENDING_COOKIE = 'ovp_2fa'
const ABSOLUTE_TTL_MS = 8 * 60 * 60 * 1000 // 8 uur
const IDLE_TTL_MS = 2 * 60 * 60 * 1000 // 2 uur inactiviteit
const PENDING_TTL_MS = 5 * 60 * 1000 // 5 min om de 2e factor af te ronden

function hmac(value: string): string {
  return createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex')
}

function secureCookies(): boolean {
  return env.NODE_ENV === 'production'
}

export function requestContext(): { ip?: string; userAgent?: string } {
  const h = headers()
  const ip =
    h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip') || undefined
  const userAgent = h.get('user-agent') || undefined
  return { ip, userAgent }
}

// --- Volledige sessie (na geslaagde 2e factor) ---

export async function createSession(accountantId: string): Promise<void> {
  const raw = randomBytes(32).toString('base64url')
  const { ip, userAgent } = requestContext()
  const expiresAt = new Date(Date.now() + ABSOLUTE_TTL_MS)
  await prisma.session.create({
    data: { accountantId, tokenHash: hmac(raw), expiresAt, ip, userAgent }
  })
  cookies().set(SESSION_COOKIE, raw, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt
  })
}

export async function getCurrentAccountant(): Promise<Accountant | null> {
  const raw = cookies().get(SESSION_COOKIE)?.value
  if (!raw) return null
  const session = await prisma.session.findUnique({
    where: { tokenHash: hmac(raw) },
    include: { accountant: true }
  })
  if (!session) return null
  const now = Date.now()
  if (session.expiresAt.getTime() < now || now - session.lastSeenAt.getTime() > IDLE_TTL_MS) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {})
    return null
  }
  if (!session.accountant.active) return null
  // Verlengt de inactiviteitsteller (max 1x/minuut om schrijfdruk te beperken).
  if (now - session.lastSeenAt.getTime() > 60_000) {
    await prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {})
  }
  return session.accountant
}

export async function requireAccountant(): Promise<Accountant> {
  const acc = await getCurrentAccountant()
  if (!acc) redirect('/login')
  return acc
}

/**
 * Vereist een ingelogde, volledig ingerichte medewerker. Zolang het wachtwoord
 * nog gewijzigd moet worden of 2FA niet actief is, wordt naar Instellingen
 * geleid — zo is tweefactorauthenticatie in de praktijk verplicht.
 */
export async function requireOnboarded(): Promise<Accountant> {
  const acc = await requireAccountant()
  if (acc.mustChangePassword || !acc.totpEnabled) redirect('/instellingen')
  return acc
}

export async function requireBeheerder(): Promise<Accountant> {
  const acc = await requireOnboarded()
  if (acc.role !== 'BEHEERDER') redirect('/dashboard')
  return acc
}

export async function destroySession(): Promise<void> {
  const raw = cookies().get(SESSION_COOKIE)?.value
  if (raw) {
    await prisma.session.deleteMany({ where: { tokenHash: hmac(raw) } }).catch(() => {})
  }
  cookies().delete(SESSION_COOKIE)
}

// --- Tussenstap: wachtwoord ok, wacht op tweede factor ---

export function setPending2fa(accountantId: string): void {
  const exp = Date.now() + PENDING_TTL_MS
  const payload = `${accountantId}.${exp}`
  const sig = hmac(payload)
  cookies().set(PENDING_COOKIE, `${payload}.${sig}`, {
    httpOnly: true,
    secure: secureCookies(),
    sameSite: 'lax',
    path: '/',
    maxAge: PENDING_TTL_MS / 1000
  })
}

export function getPending2fa(): string | null {
  const val = cookies().get(PENDING_COOKIE)?.value
  if (!val) return null
  const idx = val.lastIndexOf('.')
  if (idx < 0) return null
  const payload = val.slice(0, idx)
  const sig = val.slice(idx + 1)
  const expected = hmac(payload)
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null
  const [accountantId, expStr] = payload.split('.')
  if (!accountantId || !expStr || Number(expStr) < Date.now()) return null
  return accountantId
}

export function clearPending2fa(): void {
  cookies().delete(PENDING_COOKIE)
}
