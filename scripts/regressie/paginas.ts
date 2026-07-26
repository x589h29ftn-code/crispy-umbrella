/**
 * Rooktest: renderen de belangrijkste pagina's zonder serverfout?
 *
 * Deze test bestaat om één concrete reden. Onder `next dev` gaven de drie
 * kernschermen van de applicatie een 500 — velden plaatsen, de cliënt laten
 * ondertekenen, en zelf ondertekenen vanuit kantoor — terwijl `next build` en de
 * typecontrole volledig groen waren. Die pagina's staan op `force-dynamic`, dus
 * de build rendert ze nooit; de oorzaak lag in een module die bij het
 * server-renderen geen bruikbare export opleverde, en React meldde alleen
 * "Element type is invalid".
 *
 * Een groene build en een groene typecontrole zeggen dus niets over de vraag of
 * een pagina daadwerkelijk rendert. Deze test stelt die vraag. Hij draait tegen
 * een productiebuild, dus hij dekt niet alles wat in de ontwikkelserver kan
 * misgaan — maar hij dekt wel de klasse "pagina valt bij het renderen om", en
 * dat is precies wat er ontbrak.
 *
 * Werkwijze: seed een dossier, start `next start` tegen dezelfde database, en
 * haal elke route op. Alleen de statuscode telt; hoe het eruitziet is een andere
 * discussie.
 *
 *   npm run test:paginas
 *
 * Vereist een productiebuild (`npm run build`) en een lopende database.
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { storage } from '@/lib/storage'
import { hashPassword } from '@/lib/auth/password'
import { generateSigningToken } from '@/lib/auth/signingToken'

let fails = 0
function check(name: string, ok: boolean, extra?: unknown) {
  console.log(`${ok ? 'OK  ' : 'FOUT'}  ${name}`)
  if (!ok) {
    fails++
    if (extra !== undefined) console.log('       ', extra)
  }
}

const EMAIL = 'paginas@ottovisseraccountants.nl'
const PORT = Number(process.env.SMOKE_PORT ?? 3199)
const BASE = `http://127.0.0.1:${PORT}`

async function schoonVooraf() {
  const oud = await prisma.accountant.findUnique({ where: { email: EMAIL }, select: { id: true } })
  if (!oud) return
  for (const d of await prisma.dossier.findMany({ where: { ownerId: oud.id }, select: { id: true } })) {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
      await tx.dossier.delete({ where: { id: d.id } })
    })
  }
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL app.audit_purge = 'on'`)
    await tx.auditEvent.deleteMany({ where: { accountantId: oud.id } })
    await tx.accountant.delete({ where: { id: oud.id } })
  })
}

/** Wacht tot de server antwoordt, of geef op. */
async function wachtOpServer(pogingen = 40): Promise<boolean> {
  for (let i = 0; i < pogingen; i++) {
    try {
      const res = await fetch(`${BASE}/login`, { signal: AbortSignal.timeout(3000) })
      if (res.ok) return true
    } catch {
      /* nog niet op */
    }
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

async function main() {
  await schoonVooraf()

  // --- Testgegevens ---
  const acc = await prisma.accountant.create({
    data: {
      email: EMAIL,
      name: 'P. Agina RA',
      passwordHash: await hashPassword('Wachtwoord-Voor-Test-1'),
      role: 'BEHEERDER',
      totpEnabled: true
    }
  })
  const sessieToken = randomBytes(32).toString('hex')
  await prisma.session.create({
    data: {
      accountantId: acc.id,
      tokenHash: createHmac('sha256', env.SESSION_SECRET).update(sessieToken).digest('hex'),
      expiresAt: new Date(Date.now() + 3600_000)
    }
  })

  const { PDFDocument } = await import('@cantoo/pdf-lib')
  const leeg = await PDFDocument.create()
  leeg.addPage([595.28, 841.89])
  const bytes = Buffer.from(await leeg.save())
  const store = storage()

  const maakDossier = async (status: 'CONCEPT' | 'VERZONDEN') =>
    prisma.dossier.create({
      data: {
        title: `Rooktest ${status}`,
        ownerId: acc.id,
        status,
        sentAt: status === 'VERZONDEN' ? new Date() : null,
        expiresAt: status === 'VERZONDEN' ? new Date(Date.now() + 9 * 86400_000) : null,
        documents: {
          create: [
            {
              title: 'Testdocument',
              fileName: 'test.pdf',
              order: 0,
              originalKey: await store.put(bytes, 'pdf'),
              workingKey: await store.put(bytes, 'pdf')
            }
          ]
        }
      },
      include: { documents: true }
    })

  const concept = await maakDossier('CONCEPT')
  const verzonden = await maakDossier('VERZONDEN')

  // Externe ondertekenaar met een geldig tekentoken.
  const { raw: tekenToken, hash } = generateSigningToken()
  const extern = await prisma.recipient.create({
    data: {
      dossierId: verzonden.id,
      role: 'EXTERN',
      name: 'K. Lient',
      email: 'client@example.nl',
      order: 0,
      tokenHash: hash,
      tokenExpiresAt: new Date(Date.now() + 9 * 86400_000)
    }
  })
  await prisma.signatureField.create({
    data: {
      dossierId: verzonden.id,
      recipientId: extern.id,
      documentId: verzonden.documents[0].id,
      page: 1,
      x: 60,
      y: 200,
      width: 180,
      height: 60
    }
  })
  // Kantoorondertekenaar die nu aan de beurt is.
  const kantoor = await prisma.recipient.create({
    data: {
      dossierId: verzonden.id,
      accountantId: acc.id,
      role: 'ZELF',
      name: acc.name,
      email: acc.email,
      order: 1
    }
  })
  await prisma.signatureField.create({
    data: {
      dossierId: verzonden.id,
      recipientId: kantoor.id,
      documentId: verzonden.documents[0].id,
      page: 1,
      x: 60,
      y: 320,
      width: 180,
      height: 60
    }
  })

  // --- Server starten ---
  let server: ChildProcess | null = null
  try {
    server = spawn('npx', ['next', 'start', '-p', String(PORT)], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    })
    let serverLog = ''
    server.stdout?.on('data', (d) => (serverLog += String(d)))
    server.stderr?.on('data', (d) => (serverLog += String(d)))

    if (!(await wachtOpServer())) {
      check('de server komt op', false, serverLog.slice(-800))
      throw new Error('server niet gestart')
    }
    check('de server komt op', true)

    const cookie = `ovp_session=${sessieToken}`
    const routes: { naam: string; pad: string; cookie: boolean }[] = [
      { naam: 'inlogpagina', pad: '/login', cookie: false },
      { naam: 'dashboard', pad: '/dashboard', cookie: true },
      { naam: 'cliëntenoverzicht', pad: '/klanten', cookie: true },
      { naam: 'nieuw verzoek', pad: '/dossiers/nieuw', cookie: true },
      { naam: 'dossierdetail', pad: `/dossiers/${verzonden.id}`, cookie: true },
      // De drie pagina's met een documentvoorbeeld. Hier zat de fout.
      { naam: 'velden plaatsen (pdf-voorbeeld)', pad: `/dossiers/${concept.id}/voorbereiden`, cookie: true },
      { naam: 'kantoorondertekenen (pdf-voorbeeld)', pad: `/te-ondertekenen/${kantoor.id}`, cookie: true },
      { naam: 'tekenpagina cliënt (pdf-voorbeeld)', pad: `/teken/${tekenToken}`, cookie: false },
      { naam: 'te ondertekenen', pad: '/te-ondertekenen', cookie: true },
      { naam: 'instellingen', pad: '/instellingen', cookie: true },
      { naam: 'gebruikersbeheer', pad: '/instellingen/gebruikers', cookie: true },
      { naam: 'document controleren', pad: '/valideren', cookie: true }
    ]

    for (const r of routes) {
      let status = 0
      try {
        const res = await fetch(`${BASE}${r.pad}`, {
          headers: r.cookie ? { cookie } : {},
          redirect: 'manual',
          signal: AbortSignal.timeout(30_000)
        })
        status = res.status
      } catch (e) {
        status = -1
        console.log('       fetchfout:', (e as Error).message)
      }
      // 200 is goed; een redirect (307/308) is ook goed — dat is een bewuste
      // doorverwijzing en geen fout. Alleen 5xx betekent dat de pagina omvalt.
      const ok = status === 200 || status === 307 || status === 308
      check(`${r.naam} rendert zonder serverfout`, ok, `status ${status}`)
    }
  } finally {
    if (server) {
      server.kill('SIGTERM')
      await new Promise((r) => setTimeout(r, 1500))
      if (!server.killed) server.kill('SIGKILL')
    }
  }

  await schoonVooraf()
  console.log(fails === 0 ? '\nALLES GOED' : `\n${fails} TEST(EN) MISLUKT`)
  await prisma.$disconnect()
  process.exit(fails === 0 ? 0 : 1)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
