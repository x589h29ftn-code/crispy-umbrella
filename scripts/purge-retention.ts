// Ruimt dossiers op waarvan de bewaartermijn is verstreken. De worker doet dit
// dagelijks automatisch; dit script is er om het handmatig te bekijken of te doen.
//
//   npm run retention:purge            -> laat zien wat er zou gebeuren
//   npm run retention:purge -- --apply -> voert het uit (niet terug te draaien)
import { purgeExpiredDossiers, retentionStatus } from '@/lib/retention'
import { prisma } from '@/lib/db'

const apply = process.argv.includes('--apply')
const status = await retentionStatus()
console.log(`Bewaartermijn verstreken: ${status.due} dossier(s)`)
console.log(`Eerstvolgende verloopt   : ${status.next ? status.next.toISOString().slice(0, 10) : '-'}`)

if (status.due === 0) {
  console.log('\nNiets te doen.')
} else {
  const res = await purgeExpiredDossiers({ dryRun: !apply, limit: 1000 })
  if (apply) {
    console.log(`\nOpgeruimd: ${res.dossiers} dossier(s), ${res.documents} document(en), ${res.auditEvents} auditregel(s).`)
    if (res.skipped.length) console.error('Overgeslagen:', res.skipped)
  } else {
    console.log(`\nZou opruimen: ${res.dossiers} dossier(s), ${res.documents} document(en), ${res.auditEvents} auditregel(s).`)
    console.log('Document en bewijsspoor gaan altijd samen. Draai met --apply om het uit te voeren.')
  }
}
await prisma.$disconnect()
