// Nederlandse e-mailsjablonen. Sober, professioneel, huisstijl-blauw.
import { env } from '@/env'

const BRAND = '#2b6cad' // logoblauw Otto Visser & Partners

function layout(title: string, bodyHtml: string): string {
  const logo = `${env.APP_URL}/logo-full.jpg`
  return `<!doctype html><html lang="nl"><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.1)">
      <div style="background:${BRAND};height:6px"></div>
      <div style="padding:28px 32px">
        <img src="${logo}" alt="Otto Visser &amp; Partners" style="height:44px;margin-bottom:16px" />
        <h1 style="font-size:20px;margin:0 0 16px">${title}</h1>
        ${bodyHtml}
      </div>
    </div>
    <p style="color:#94a3b8;font-size:12px;text-align:center;margin-top:16px">
      Dit bericht is verstuurd door het ondertekenportaal van Otto Visser &amp; Partners.
    </p>
  </div></body></html>`
}

function button(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:${BRAND};color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600">${label}</a>`
}

export function requestEmail(opts: {
  recipientName: string
  senderName: string
  documentTitle: string
  url: string
  message?: string | null
}): { subject: string; html: string; text: string } {
  const subject = `Ondertekenverzoek: ${opts.documentTitle}`
  const intro = opts.message?.trim()
    ? `<p>${escapeHtml(opts.message)}</p>`
    : `<p>${escapeHtml(opts.senderName)} van Otto Visser &amp; Partners vraagt u het document <strong>${escapeHtml(
        opts.documentTitle
      )}</strong> digitaal te ondertekenen.</p>`
  const html = layout(
    'Verzoek om te ondertekenen',
    `<p>Beste ${escapeHtml(opts.recipientName)},</p>
     ${intro}
     <p>U tekent veilig online in uw browser - er is geen software nodig. Voor de zekerheid ontvangt u eerst een verificatiecode per e-mail.</p>
     <p style="margin:24px 0">${button(opts.url, 'Document openen en ondertekenen')}</p>
     <p style="color:#64748b;font-size:13px">Werkt de knop niet? Kopieer deze link:<br>${opts.url}</p>
     <p>Met vriendelijke groet,<br>${escapeHtml(opts.senderName)}<br>Otto Visser &amp; Partners</p>`
  )
  const text = `Beste ${opts.recipientName},\n\n${
    opts.message?.trim() ||
    `${opts.senderName} van Otto Visser & Partners vraagt u het document "${opts.documentTitle}" digitaal te ondertekenen.`
  }\n\nOnderteken veilig online via deze link:\n${opts.url}\n\nMet vriendelijke groet,\n${opts.senderName}\nOtto Visser & Partners`
  return { subject, html, text }
}

export function reminderEmail(opts: {
  recipientName: string
  senderName: string
  documentTitle: string
  url: string
}): { subject: string; html: string; text: string } {
  const subject = `Herinnering: onderteken "${opts.documentTitle}"`
  const html = layout(
    'Herinnering om te ondertekenen',
    `<p>Beste ${escapeHtml(opts.recipientName)},</p>
     <p>Wij hebben u eerder gevraagd het document <strong>${escapeHtml(
       opts.documentTitle
     )}</strong> te ondertekenen. Dit is nog niet gebeurd.</p>
     <p style="margin:24px 0">${button(opts.url, 'Alsnog ondertekenen')}</p>
     <p style="color:#64748b;font-size:13px">Link: ${opts.url}</p>
     <p>Met vriendelijke groet,<br>${escapeHtml(opts.senderName)}<br>Otto Visser &amp; Partners</p>`
  )
  const text = `Beste ${opts.recipientName},\n\nHerinnering: het document "${opts.documentTitle}" wacht nog op uw handtekening.\n\nOnderteken via:\n${opts.url}\n\nMet vriendelijke groet,\n${opts.senderName}\nOtto Visser & Partners`
  return { subject, html, text }
}

export function officeTurnEmail(opts: { recipientName: string; documentTitle: string; url: string }): {
  subject: string
  html: string
  text: string
} {
  const subject = `Uw handtekening gevraagd: ${opts.documentTitle}`
  const html = layout(
    'Er wacht een document op uw handtekening',
    `<p>Beste ${escapeHtml(opts.recipientName)},</p>
     <p>Het document <strong>${escapeHtml(
       opts.documentTitle
     )}</strong> staat klaar om door u te worden ondertekend in het portaal.</p>
     <p style="margin:24px 0">${button(opts.url, 'Openen in het portaal')}</p>
     <p style="color:#64748b;font-size:13px">U bent nu aan de beurt in de ondertekenvolgorde.</p>`
  )
  const text = `Beste ${opts.recipientName},\n\nHet document "${opts.documentTitle}" staat klaar om door u te worden ondertekend in het portaal:\n${opts.url}\n\nU bent nu aan de beurt in de ondertekenvolgorde.`
  return { subject, html, text }
}

export function otpEmail(opts: { recipientName: string; code: string; ttlMinutes: number }): {
  subject: string
  html: string
  text: string
} {
  const subject = `Uw verificatiecode: ${opts.code}`
  const html = layout(
    'Uw verificatiecode',
    `<p>Beste ${escapeHtml(opts.recipientName)},</p>
     <p>Gebruik onderstaande code om uw identiteit te bevestigen en het document te ondertekenen:</p>
     <p style="font-size:34px;font-weight:700;letter-spacing:8px;color:${BRAND};margin:20px 0">${opts.code}</p>
     <p style="color:#64748b;font-size:13px">De code is ${opts.ttlMinutes} minuten geldig. Deel hem met niemand.</p>`
  )
  const text = `Beste ${opts.recipientName},\n\nUw verificatiecode is: ${opts.code}\nDe code is ${opts.ttlMinutes} minuten geldig. Deel hem met niemand.`
  return { subject, html, text }
}

/**
 * De voltooiingsmail. Deze mail is méér dan een bevestiging: hij is het eigen
 * exemplaar van de cliënt.
 *
 * Daarom staan de controlegetallen (SHA-256) in de body als leesbare tekst. Ze
 * belanden zo in de mailbox van de cliënt, met zíjn ontvangstdatum, buiten ons
 * beheer. Dat dekt precies het scenario waarin een onafhankelijk zegel telt:
 * dat iemand óns kantoor verdenkt. Wij kunnen die mail niet aanpassen.
 *
 * Let op de volgorde: de hash van het verzegelde bestand kán niet op de
 * auditpagina in het PDF staan, want die pagina zit ín het bestand waarvan de
 * hash wordt berekend. Vandaar dat het certificaat uitlegt dat de hash per
 * persoon over de getoonde versie gaat, en dat deze mail de hash van het
 * eindbestand draagt.
 */
export function completedEmail(opts: {
  recipientName: string
  documentTitle: string
  /** Per document de SHA-256 van het verzegelde bestand. */
  hashes?: { title: string; sha256: string }[]
  /** Downloadlink voor het getekende exemplaar (optioneel). */
  downloadUrl?: string | null
  downloadDagen?: number
}): {
  subject: string
  html: string
  text: string
} {
  const subject = `Ondertekend: ${opts.documentTitle}`
  const dagen = opts.downloadDagen ?? 90
  const hashes = opts.hashes ?? []

  const hashHtml = hashes.length
    ? `<p style="margin-top:20px"><strong>Controlegetallen</strong><br>
       <span style="color:#64748b;font-size:13px">Deze code hoort bij het bijgevoegde document. Bewaar deze
       e-mail; hij is uw eigen controlemiddel.</span></p>
       ${hashes
         .map(
           (h) =>
             `<p style="margin:6px 0;font-size:13px">${escapeHtml(h.title)}<br>
              <code style="font-family:Consolas,monospace;font-size:12px;color:#1d4ed8;word-break:break-all">${h.sha256}</code></p>`
         )
         .join('')}`
    : ''

  const downloadHtml = opts.downloadUrl
    ? `<p style="margin:24px 0">${button(opts.downloadUrl, 'Document downloaden')}</p>
       <p style="color:#64748b;font-size:13px">Deze downloadlink werkt ${dagen} dagen. Bewaar deze e-mail met het
       document als uw eigen exemplaar.</p>`
    : ''

  const html = layout(
    'Document volledig ondertekend',
    `<p>Beste ${escapeHtml(opts.recipientName)},</p>
     <p>Het document <strong>${escapeHtml(
       opts.documentTitle
     )}</strong> is door alle partijen ondertekend. De definitieve, verzegelde versie vindt u in de bijlage.</p>
     ${downloadHtml}
     ${hashHtml}
     <p>Met vriendelijke groet,<br>Otto Visser &amp; Partners</p>`
  )

  const hashText = hashes.length
    ? `\n\nControlegetallen (SHA-256). Deze code hoort bij het bijgevoegde document. Bewaar deze e-mail; hij is uw eigen controlemiddel.\n` +
      hashes.map((h) => `  ${h.title}\n  ${h.sha256}`).join('\n')
    : ''
  const downloadText = opts.downloadUrl
    ? `\n\nDownloaden: ${opts.downloadUrl}\nDeze downloadlink werkt ${dagen} dagen. Bewaar deze e-mail met het document als uw eigen exemplaar.`
    : ''
  const text =
    `Beste ${opts.recipientName},\n\nHet document "${opts.documentTitle}" is door alle partijen ondertekend. ` +
    `De verzegelde versie zit in de bijlage.${downloadText}${hashText}\n\nMet vriendelijke groet,\nOtto Visser & Partners`
  return { subject, html, text }
}

export function passwordResetEmail(opts: { name: string; url: string; ttlMinutes: number }): {
  subject: string
  html: string
  text: string
} {
  const subject = 'Wachtwoord opnieuw instellen'
  const html = layout(
    'Wachtwoord opnieuw instellen',
    `<p>Beste ${escapeHtml(opts.name)},</p>
     <p>U heeft gevraagd om uw wachtwoord voor het ondertekenportaal opnieuw in te stellen. Klik op de knop hieronder
     om een nieuw wachtwoord te kiezen. Deze link is ${opts.ttlMinutes} minuten geldig en werkt eenmalig.</p>
     <p style="margin:24px 0">${button(opts.url, 'Nieuw wachtwoord instellen')}</p>
     <p style="color:#64748b;font-size:13px">Werkt de knop niet? Kopieer deze link:<br>${opts.url}</p>
     <p style="color:#64748b;font-size:13px">Heeft u dit niet aangevraagd? Dan kunt u deze e-mail negeren; er verandert
     niets aan uw account.</p>
     <p>Met vriendelijke groet,<br>Otto Visser &amp; Partners</p>`
  )
  const text = `Beste ${opts.name},\n\nU heeft gevraagd uw wachtwoord opnieuw in te stellen. Gebruik deze link (${opts.ttlMinutes} minuten geldig, eenmalig):\n${opts.url}\n\nHeeft u dit niet aangevraagd? Negeer deze e-mail.\n\nMet vriendelijke groet,\nOtto Visser & Partners`
  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
