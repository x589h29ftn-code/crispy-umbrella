// Bepaalt het client-IP uit de proxy-headers voor rate-limiting en het
// auditspoor. Belangrijk voor de beveiliging: een client kan zelf een
// X-Forwarded-For-header meesturen. Achter één vertrouwde reverse proxy
// (Caddy) is het IP dat de proxy toevoegt het MEEST rechtse item; dat kan de
// aanvaller niet vervalsen. We nemen daarom bewust het laatste item, niet het
// eerste (dat is client-gestuurd en spoofbaar).
export function clientIp(xForwardedFor: string | null, xRealIp?: string | null): string | undefined {
  if (xForwardedFor) {
    const parts = xForwardedFor
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 0) return parts[parts.length - 1]
  }
  const real = xRealIp?.trim()
  return real || undefined
}
