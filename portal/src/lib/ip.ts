// Bepaalt het client-IP uit de proxy-headers voor rate-limiting en het
// auditspoor. Belangrijk voor de beveiliging: een client kan zelf een
// X-Forwarded-For-header meesturen. Achter één vertrouwde reverse proxy
// (Caddy) is het IP dat de proxy toevoegt het MEEST rechtse item; dat kan de
// aanvaller niet vervalsen. We nemen daarom bewust het laatste item, niet het
// eerste (dat is client-gestuurd en spoofbaar).
// `hops` is het aantal vertrouwde proxies vóór de app (Caddy alleen = 1). We
// tellen dat aantal vanaf rechts terug: bij 1 hop is de laatste waarde het
// echte client-IP, bij 2 de één-na-laatste. Meer vertrouwen dan het ingestelde
// aantal doen we nooit, want die waarden komen van de client zelf.
export function clientIp(
  xForwardedFor: string | null,
  xRealIp?: string | null,
  hops = 1
): string | undefined {
  if (xForwardedFor) {
    const parts = xForwardedFor
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length > 0) {
      const index = parts.length - Math.max(1, hops)
      return parts[Math.max(0, index)]
    }
  }
  const real = xRealIp?.trim()
  return real || undefined
}
