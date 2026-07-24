// Controleert de hashketen van het auditspoor van begin tot eind en meldt waar
// hij breekt. Draai met:  npm run audit:verify
import { verifyAuditChain } from '@/lib/audit'

const result = await verifyAuditChain()
if (result.ok) {
  console.log(`Auditspoor is intact. ${result.checked} regel(s) gecontroleerd.`)
  process.exit(0)
}
console.error(`Auditspoor is GEBROKEN na ${result.checked} regel(s).`)
if (result.brokenAt) {
  console.error(`  Regel:  ${result.brokenAt.id}`)
  console.error(`  Type:   ${result.brokenAt.type}`)
  console.error(`  Tijd:   ${result.brokenAt.createdAt.toISOString()}`)
  console.error(`  Reden:  ${result.brokenAt.reason}`)
}
process.exit(1)
