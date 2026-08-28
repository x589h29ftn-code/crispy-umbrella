/**
 * Datum-/tijdweergave voor opmerkingen: "4-7-2026 14:05". Staat los van de
 * lightbox zodat het leestabblad hem kan gebruiken zonder die hele (zware)
 * module mee te laden.
 */
export function formatCommentTime(ms: number): string {
  const d = new Date(ms)
  return `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`
}
