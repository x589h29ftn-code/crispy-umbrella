import 'server-only'
import { Pool } from 'pg'
import { env } from '@/env'

// Eén zware documentbewerking tegelijk, over ALLE containers heen.
//
// Waarom dit bestaat. De machine heeft 4 GB. LibreOffice vraagt bij een grote
// jaarrekening honderden megabytes, tesseract bij OCR van een gescand stuk ook. Twee
// van die twee tegelijk is de manier waarop deze server omvalt. Bij 10 documenten
// per dag en maximaal twee gelijktijdige medewerkers is dat zeldzaam — en precies
// daarom een fout die je pas op het slechtste moment vindt.
//
// Wat er is gekozen, en waarom anders dan geadviseerd. Changeset v1.4 stelde nieuwe
// job-kinds voor (`CONVERT`, `OCR`) met een worker die er één tegelijk pakt. Dat
// levert dezelfde geheugengarantie, maar verandert het uploaden van synchroon naar
// asynchroon: de medewerker zou een "wordt verwerkt"-status krijgen en moeten
// wachten op een pagina die zichzelf ververst. Dat is meer bouwwerk en meer uitleg
// voor hetzelfde doel.
//
// In plaats daarvan: een advisory lock in Postgres. Die werkt over
// containergrenzen heen (een semafoor in het geheugen doet dat niet — web en worker
// zijn aparte processen), hij valt automatisch vrij als de verbinding wegvalt, en
// het is één bestand in plaats van een nieuwe jobsoort met eigen statuspagina.
//
// Wat het kost: de tweede medewerker wacht. Bij deze volumes gaat dat om seconden,
// en de wachttijd is begrensd — na de timeout krijgt hij een leesbare melding in
// plaats van een half omgevallen server.

/** Vaste sleutel voor de documentbewerkingslock. */
const DOCPREP_LOCK_KEY = 918_273

/** Hoe lang een aanvrager maximaal wacht op zijn beurt. */
const WACHT_TIMEOUT_MS = 120_000

/** Hoe vaak er opnieuw wordt geprobeerd de lock te pakken. */
const POLL_MS = 250

let pool: Pool | null = null
function getPool(): Pool {
  if (!pool) {
    // Klein: er mag er maar één tegelijk werken, dus meer verbindingen dan dit
    // hebben geen zin.
    pool = new Pool({ connectionString: env.DATABASE_URL, max: 3 })
    pool.on('error', (e) => console.error('[docprep] poolfout', e))
  }
  return pool
}

export class DocPrepBusyError extends Error {
  readonly busy = true as const
  constructor() {
    super(
      'Er wordt op dit moment een ander document omgezet. Probeer het over een minuut opnieuw; ' +
        'de server doet er bewust één tegelijk zodat hij niet omvalt.'
    )
  }
}

/**
 * Voert `fn` uit terwijl niemand anders een zware documentbewerking doet.
 *
 * `pg_try_advisory_lock` en niet de blokkerende variant: zo houden we zelf de
 * wachttijd in de hand en kunnen we een nette melding geven in plaats van een
 * verbinding die minutenlang hangt.
 */
export async function withDocPrepLock<T>(fn: () => Promise<T>): Promise<T> {
  // Zonder database (tests, scripts) niet blokkeren: dan is er ook geen tweede
  // proces dat gelijktijdig kan werken.
  if (env.DOCPREP_SERIALIZE === false) return fn()

  const client = await getPool().connect()
  let vergrendeld = false
  try {
    const deadline = Date.now() + WACHT_TIMEOUT_MS
    while (Date.now() < deadline) {
      const res = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [
        DOCPREP_LOCK_KEY
      ])
      if (res.rows[0]?.locked) {
        vergrendeld = true
        break
      }
      await new Promise((r) => setTimeout(r, POLL_MS))
    }
    if (!vergrendeld) throw new DocPrepBusyError()
    return await fn()
  } finally {
    if (vergrendeld) {
      // Altijd vrijgeven. Valt het proces om zonder dit te doen, dan geeft Postgres
      // de lock vrij zodra de verbinding sluit — session-scoped locks hangen niet
      // aan een transactie maar aan de verbinding.
      await client.query('SELECT pg_advisory_unlock($1)', [DOCPREP_LOCK_KEY]).catch((e) => {
        console.error('[docprep] kon de lock niet vrijgeven', e)
      })
    }
    client.release()
  }
}
