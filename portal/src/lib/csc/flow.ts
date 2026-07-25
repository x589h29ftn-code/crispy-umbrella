import 'server-only'
import { prisma } from '@/lib/db'
import { env } from '@/env'
import { storage } from '@/lib/storage'
import { writeAudit } from '@/lib/audit'
import { preparePdfForExternalSigning, injectExternalSignature, sha256Hex } from '@/lib/seal/sealer'
import {
  buildAuthorizeUrl,
  cleverbaseConfig,
  credentialInfo,
  exchangeCodeForSad,
  fetchServiceToken,
  isExpiredSad,
  signHashes,
  CscError
} from './client'
import { assertCredentialUsable, createSession, markSession, resolveSession } from './session'

// Orkestratie van het gekwalificeerd ondertekenen waarbij de accountant zelf
// autoriseert.
//
// Waarom dit een eigen, expliciete stap is en niet meelift op het tekenmoment:
// zodra er een handtekening in een PDF zit mag het bestand niet meer worden
// bewerkt. Het auditcertificaat en het plat slaan moeten er dus vóór gebeuren.
// Die zijn pas klaar als alle partijen hebben getekend — en op dat moment is de
// accountant er niet noodzakelijk bij om een pincode in te voeren.
//
// Daarom: als alles getekend is, komt het dossier op WACHT_OP_WAARMERK. De
// accountant ziet dat als taak en bevestigt in één keer voor meerdere stukken
// (de provider staat tot 50 hashes onder één bevestiging toe).

export interface WaitingDocument {
  documentId: string
  dossierId: string
  dossierTitle: string
  documentTitle: string
}

/** Documenten die op de gekwalificeerde handtekening van deze accountant wachten. */
export async function documentsAwaitingSignature(accountantId: string): Promise<WaitingDocument[]> {
  const dossiers = await prisma.dossier.findMany({
    where: { ownerId: accountantId, status: 'WACHT_OP_WAARMERK' },
    orderBy: { updatedAt: 'asc' },
    select: {
      id: true,
      title: true,
      documents: {
        where: { preSealKey: { not: null }, sealedKey: null },
        orderBy: { order: 'asc' },
        select: { id: true, title: true }
      }
    }
  })
  return dossiers.flatMap((d) =>
    d.documents.map((doc) => ({
      documentId: doc.id,
      dossierId: d.id,
      dossierTitle: d.title,
      documentTitle: doc.title
    }))
  )
}

export type InitiateResult =
  | { ok: true; authorizeUrl: string; documentCount: number }
  | { ok: false; error: string }

/**
 * Fase 1: bereidt de geselecteerde documenten voor en geeft de URL waar de
 * accountant naartoe gaat om te bevestigen.
 *
 * Alle hashes worden hier al berekend: de autorisatie geldt voor precies deze
 * verzameling, en het SAD-token leeft daarna maar kort.
 */
export async function initiateQualifiedSigning(input: {
  accountantId: string
  documentIds: string[]
}): Promise<InitiateResult> {
  if (env.PROFESSIONAL_SIGNING_DRIVER !== 'cleverbase') {
    return { ok: false, error: 'Er is geen provider ingesteld die om uw bevestiging vraagt.' }
  }
  if (input.documentIds.length === 0) return { ok: false, error: 'Kies minstens één document.' }
  if (input.documentIds.length > env.CLEVERBASE_MAX_BATCH) {
    return {
      ok: false,
      error: `U kunt maximaal ${env.CLEVERBASE_MAX_BATCH} documenten in één bevestiging meenemen.`
    }
  }

  const accountant = await prisma.accountant.findUnique({ where: { id: input.accountantId } })
  if (!accountant?.signingCertEnabled || !accountant.signingCredentialId) {
    return { ok: false, error: 'Voor uw account staat gekwalificeerd ondertekenen niet aan.' }
  }

  // Alleen documenten uit eigen dossiers die daadwerkelijk wachten.
  const documents = await prisma.document.findMany({
    where: {
      id: { in: input.documentIds },
      preSealKey: { not: null },
      sealedKey: null,
      dossier: { ownerId: input.accountantId, status: 'WACHT_OP_WAARMERK' }
    },
    select: { id: true, title: true, preSealKey: true, dossierId: true }
  })
  if (documents.length !== input.documentIds.length) {
    return { ok: false, error: 'Een of meer documenten wachten niet (meer) op uw handtekening.' }
  }

  let cfg
  try {
    cfg = cleverbaseConfig()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  try {
    const { accessToken } = await fetchServiceToken(cfg)
    // Bij elke sessie opnieuw controleren: de provider trekt het certificaat in
    // zodra de inschrijving in het register eindigt of wordt geschorst.
    const usable = await assertCredentialUsable({
      cfg,
      serviceToken: accessToken,
      accountantId: accountant.id,
      credentialId: accountant.signingCredentialId
    })
    if (!usable.ok) return { ok: false, error: usable.reason }

    // Placeholder + hash per document. De volgorde is bindend: de provider geeft
    // de handtekeningen in dezelfde orde terug.
    const store = storage()
    const documentIds: string[] = []
    const preparedKeys: Record<string, string> = {}
    const hashesBase64: Record<string, string> = {}
    const prepared: Record<string, unknown> = {}

    for (const doc of documents) {
      const preSeal = await store.get(doc.preSealKey!)
      const p = await preparePdfForExternalSigning({
        pdfBytes: preSeal,
        certChainBase64: usable.certificates,
        reason: `Ondertekend door ${accountant.name}${accountant.professionalTitle ? `, ${accountant.professionalTitle}` : ''}`
      })
      // De voorbereide PDF versleuteld wegschrijven; hij moet de redirect overleven.
      const key = await store.put(Buffer.from(p.preparedPdf, 'base64'), 'pdf')
      documentIds.push(doc.id)
      preparedKeys[doc.id] = key
      hashesBase64[doc.id] = p.hashToSign
      prepared[doc.id] = {
        signedAttrs: p.signedAttrs,
        documentDigest: p.documentDigest,
        reservedRegionStart: p.reservedRegionStart,
        reservedRegionEnd: p.reservedRegionEnd
      }
    }

    const { state } = await createSession({
      accountantId: accountant.id,
      credentialId: accountant.signingCredentialId,
      dossierId: documents[0].dossierId,
      documentIds,
      // Naast de opslagsleutel bewaren we per document wat /inject nodig heeft.
      preparedKeys: { ...preparedKeys, __prepared: JSON.stringify(prepared) },
      hashesBase64,
      serviceToken: accessToken
    })

    const authorizeUrl = buildAuthorizeUrl({
      cfg,
      credentialId: accountant.signingCredentialId,
      hashesBase64: documentIds.map((id) => hashesBase64[id]),
      state
    })

    await writeAudit({
      type: 'CSC_AUTORISATIE_GESTART',
      accountantId: accountant.id,
      message: `${documentIds.length} document(en) aangeboden ter bevestiging`,
      metadata: { documentIds, credentialId: accountant.signingCredentialId }
    })

    return { ok: true, authorizeUrl, documentCount: documentIds.length }
  } catch (e) {
    const err = e as CscError
    await writeAudit({
      type: 'CSC_ONDERTEKENING_MISLUKT',
      accountantId: input.accountantId,
      message: `voorbereiden mislukt: ${err.message}`.slice(0, 500)
    })
    return { ok: false, error: `Voorbereiden mislukt: ${err.message}` }
  }
}

export type CompleteResult =
  | { ok: true; dossierIds: string[]; documentCount: number }
  | { ok: false; error: string; expired?: boolean }

/**
 * Fase 2: verwerkt de callback. Wisselt de code in voor een SAD, laat de hashes
 * ondertekenen en zet de handtekeningen in de documenten.
 *
 * De batch is atomair: mislukt er één, dan wordt er niets geïnjecteerd. Een half
 * ondertekende verzameling is erger dan geen.
 */
export async function completeQualifiedSigning(input: {
  code: string
  state: string
  accountantId: string
}): Promise<CompleteResult> {
  const resolved = await resolveSession(input.state, input.accountantId)
  if (!resolved.ok) {
    const messages: Record<string, string> = {
      onbekend: 'Deze bevestiging hoort niet bij een lopende ondertekensessie.',
      verlopen: 'De bevestiging kwam te laat binnen. Begin opnieuw.',
      afgehandeld: 'Deze ondertekensessie is al afgerond.',
      'geen-eigenaar': 'Deze ondertekensessie hoort bij een andere gebruiker.'
    }
    if (resolved.reason === 'verlopen') {
      await writeAudit({
        type: 'CSC_AUTORISATIE_VERLOPEN',
        accountantId: input.accountantId,
        message: 'sessie verlopen voordat de bevestiging binnenkwam'
      })
    }
    return { ok: false, error: messages[resolved.reason], expired: resolved.reason === 'verlopen' }
  }
  const session = resolved.session

  let cfg
  try {
    cfg = cleverbaseConfig()
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }

  await markSession(session.id, 'AUTHORIZING')
  await writeAudit({
    type: 'CSC_AUTORISATIE_ONTVANGEN',
    accountantId: input.accountantId,
    message: `${session.documentIds.length} document(en)`
  })

  const store = storage()
  const preparedMeta = JSON.parse((session.preparedKeys as Record<string, string>).__prepared ?? '{}') as Record<
    string,
    { signedAttrs: string; documentDigest: string; reservedRegionStart: number; reservedRegionEnd: number }
  >

  try {
    const { sad } = await exchangeCodeForSad(cfg, input.code)
    const serviceToken = session.serviceToken ?? (await fetchServiceToken(cfg)).accessToken

    // Certificaatketen opnieuw ophalen: die hebben we nodig voor de CMS én het is
    // een tweede moment om een intrekking te zien.
    const info = await credentialInfo(cfg, serviceToken, session.credentialId)
    if ((info.keyStatus ?? '').toLowerCase() !== 'enabled' && info.keyStatus) {
      throw new CscError(`certificaat niet bruikbaar (status ${info.keyStatus})`, 403, false)
    }

    const hashes = session.documentIds.map((id) => session.hashesBase64[id])
    const signatures = await signHashes({
      cfg,
      serviceToken,
      sad,
      credentialId: session.credentialId,
      hashesBase64: hashes
    })

    // Eerst alles injecteren in het geheugen; pas daarna wegschrijven. Zo blijft
    // de batch atomair: gaat er iets mis, dan is er nog niets veranderd.
    const results: { documentId: string; bytes: Buffer }[] = []
    for (let i = 0; i < session.documentIds.length; i++) {
      const documentId = session.documentIds[i]
      const meta = preparedMeta[documentId]
      const key = (session.preparedKeys as Record<string, string>)[documentId]
      if (!meta || !key) throw new CscError(`voorbereide gegevens ontbreken voor document ${documentId}`, 0, false)
      const preparedPdf = await store.get(key)
      const bytes = await injectExternalSignature({
        preparedPdfBase64: Buffer.from(preparedPdf).toString('base64'),
        prepared: meta,
        signatureValueBase64: signatures[i],
        certChainBase64: info.certificates
      })
      results.push({ documentId, bytes })
    }

    // Vanaf hier vastleggen.
    const dossierIds = new Set<string>()
    for (const r of results) {
      const sealedKey = await store.put(r.bytes, 'pdf')
      const doc = await prisma.document.update({
        where: { id: r.documentId },
        data: { sealedKey, sealedSha256: sha256Hex(r.bytes), sealedAt: new Date() },
        select: { dossierId: true }
      })
      dossierIds.add(doc.dossierId)
    }
    await markSession(session.id, 'SIGNED')

    // Tijdelijke, voorbereide bestanden opruimen.
    for (const documentId of session.documentIds) {
      const key = (session.preparedKeys as Record<string, string>)[documentId]
      if (key) await store.remove(key).catch(() => {})
    }

    for (const dossierId of dossierIds) {
      await writeAudit({
        type: 'GEKWALIFICEERD_ONDERTEKEND',
        dossierId,
        accountantId: input.accountantId,
        message: `cleverbase (${info.subjectDn ?? 'onbekend'})`,
        metadata: { certSerial: info.credentialId }
      })
    }

    // Afronden: zegel (indien ingesteld) plus archief en mails.
    const { completeAfterQualifiedSigning } = await import('@/lib/signflow')
    for (const dossierId of dossierIds) {
      await completeAfterQualifiedSigning(dossierId)
    }

    return { ok: true, dossierIds: [...dossierIds], documentCount: results.length }
  } catch (e) {
    const err = e as CscError
    const expired = isExpiredSad(err)
    await markSession(session.id, expired ? 'EXPIRED' : 'FAILED', err.message)
    await writeAudit({
      type: expired ? 'CSC_AUTORISATIE_VERLOPEN' : 'CSC_ONDERTEKENING_MISLUKT',
      accountantId: input.accountantId,
      message: err.message.slice(0, 500),
      metadata: { status: err.status, documentIds: session.documentIds }
    })
    return {
      ok: false,
      expired,
      error: expired
        ? 'De bevestiging was niet meer geldig (deze verloopt na enkele minuten). Begin opnieuw; er is niets ondertekend.'
        : `Ondertekenen mislukt: ${err.message}. Er is niets ondertekend.`
    }
  }
}
