// Nederlandse e-mailsjablonen. Sober, professioneel, huisstijl-blauw.

const BRAND = '#1d4ed8'

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html lang="nl"><body style="margin:0;background:#f1f5f9;font-family:Segoe UI,Arial,sans-serif;color:#0f172a">
  <div style="max-width:560px;margin:0 auto;padding:24px">
    <div style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.1)">
      <div style="background:${BRAND};height:6px"></div>
      <div style="padding:28px 32px">
        <div style="font-size:13px;color:#64748b;letter-spacing:.4px;text-transform:uppercase;margin-bottom:12px">Otto Visser &amp; Partners</div>
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
     <p>U tekent veilig online in uw browser — er is geen software nodig. Voor de zekerheid ontvangt u eerst een verificatiecode per e-mail.</p>
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

export function completedEmail(opts: { recipientName: string; documentTitle: string }): {
  subject: string
  html: string
  text: string
} {
  const subject = `Ondertekend: ${opts.documentTitle}`
  const html = layout(
    'Document volledig ondertekend',
    `<p>Beste ${escapeHtml(opts.recipientName)},</p>
     <p>Het document <strong>${escapeHtml(
       opts.documentTitle
     )}</strong> is door alle partijen ondertekend. De definitieve, verzegelde versie vindt u in de bijlage.</p>
     <p>Met vriendelijke groet,<br>Otto Visser &amp; Partners</p>`
  )
  const text = `Beste ${opts.recipientName},\n\nHet document "${opts.documentTitle}" is door alle partijen ondertekend. De verzegelde versie zit in de bijlage.\n\nMet vriendelijke groet,\nOtto Visser & Partners`
  return { subject, html, text }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
