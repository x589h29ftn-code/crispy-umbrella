import { unzipSync, strFromU8 } from 'fflate'

/** Een invoerveld van een sjabloon; de sleutel = de {variabele} in het Word-bestand. */
export interface TemplateField {
  key: string
  label: string
  type: 'text' | 'multiline' | 'date' | 'amount' | 'select' | 'computed'
  required: boolean
  /** Berekend veld: percentage van een ander veld, of som/verschil van twee velden. */
  formula?: { op: 'pct' | 'sub' | 'add'; a: string; b?: string; pct?: number }
  /** Voorbeeldtekst in het lege invulveld. */
  placeholder?: string
  /** Extra uitleg onder het veld. */
  help?: string
  /** Sectiegroep-kop waaronder het veld in het formulier staat. */
  section?: string
  /** Verborgen: variabele bestaat in het sjabloon maar staat niet in het formulier. */
  hidden?: boolean
  /** Conditioneel zichtbaar: alleen tonen als een ander veld (een bepaalde) waarde heeft. */
  visibleIf?: { key: string; equals?: string }
  /** Datumnotatie in het document: 10-07-2026 of "10 juli 2026". */
  dateFormat?: 'kort' | 'lang'
  /** Opties voor een keuzelijst. */
  options?: string[]
  /** Invoercontrole op het veld. */
  validation?: 'none' | 'email' | 'iban' | 'postcode' | 'kvk'
  /** Waarde tonen als klantidentificatie in de geschiedenis. */
  isClientId?: boolean
}

export interface DocTemplate {
  id: string
  name: string
  category: string
  description?: string
  version: number
  /** Bestandsnaam-patroon, bv. "{Klantnaam} {datum} {templatenaam}". */
  filePattern?: string
  /** Automatisch oplopend volgnummer, beschikbaar als {volgnummer}. */
  autoNumber?: boolean
  nextNumber?: number
  fields: TemplateField[]
  createdAt: number
}

/** Is het veld zichtbaar in het formulier bij de huidige waarden? */
export function isFieldVisible(field: TemplateField, values: Record<string, string>): boolean {
  if (field.hidden) return false
  if (!field.visibleIf?.key) return true
  const other = (values[field.visibleIf.key] ?? '').trim()
  if (field.visibleIf.equals !== undefined && field.visibleIf.equals !== '') {
    return other.toLowerCase() === field.visibleIf.equals.trim().toLowerCase()
  }
  return other.length > 0
}

/**
 * Automatische variabelen die altijd beschikbaar zijn bij het invullen:
 * {datum}, {templatenaam} en — met volgnummer aan — {volgnummer}.
 */
export function autoValues(template: DocTemplate): Record<string, string> {
  const d = new Date()
  const out: Record<string, string> = {
    datum: `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`,
    templatenaam: template.name
  }
  if (template.autoNumber) out.volgnummer = String(template.nextNumber ?? 1)
  return out
}

// ---- Concepten: half-ingevulde formulieren per sjabloon bewaren ----

const LS_DRAFT_PREFIX = 'pdf-studio-template-draft-'

export function saveDraft(templateId: string, values: Record<string, string>): void {
  window.localStorage.setItem(LS_DRAFT_PREFIX + templateId, JSON.stringify(values))
}

export function loadDraft(templateId: string): Record<string, string> | null {
  try {
    const raw = window.localStorage.getItem(LS_DRAFT_PREFIX + templateId)
    return raw ? (JSON.parse(raw) as Record<string, string>) : null
  } catch {
    return null
  }
}

export function clearDraft(templateId: string): void {
  window.localStorage.removeItem(LS_DRAFT_PREFIX + templateId)
}

// ---- Opslag: via de desktop-API (userData/templates); in de browser/test
// ---- valt het terug op localStorage (metadata + base64-docx).

const LS_INDEX = 'pdf-studio-templates'
const LS_DOCX_PREFIX = 'pdf-studio-template-docx-'

function hasDesktopStore(): boolean {
  return typeof window.api?.templatesList === 'function'
}

export async function listTemplates(): Promise<DocTemplate[]> {
  if (hasDesktopStore()) {
    try {
      return ((await window.api.templatesList!()) as DocTemplate[]) ?? []
    } catch {
      return []
    }
  }
  try {
    return JSON.parse(window.localStorage.getItem(LS_INDEX) ?? '[]')
  } catch {
    return []
  }
}

export async function saveTemplate(meta: DocTemplate, docx: Uint8Array | null): Promise<boolean> {
  if (hasDesktopStore()) {
    const r = await window.api.templatesSave!(JSON.stringify(meta), docx)
    return r.ok
  }
  const list = await listTemplates()
  const idx = list.findIndex((t) => t.id === meta.id)
  if (idx >= 0) list[idx] = meta
  else list.push(meta)
  window.localStorage.setItem(LS_INDEX, JSON.stringify(list))
  if (docx) {
    let bin = ''
    for (const b of docx) bin += String.fromCharCode(b)
    window.localStorage.setItem(LS_DOCX_PREFIX + meta.id, btoa(bin))
  }
  return true
}

export async function deleteTemplate(id: string): Promise<void> {
  if (hasDesktopStore()) {
    await window.api.templatesDelete!(id)
    return
  }
  const list = (await listTemplates()).filter((t) => t.id !== id)
  window.localStorage.setItem(LS_INDEX, JSON.stringify(list))
  window.localStorage.removeItem(LS_DOCX_PREFIX + id)
}

export async function loadTemplateDocx(id: string): Promise<Uint8Array | null> {
  if (hasDesktopStore()) {
    const data = await window.api.templatesLoadDocx!(id)
    return data ? new Uint8Array(data) : null
  }
  const b64 = window.localStorage.getItem(LS_DOCX_PREFIX + id)
  if (!b64) return null
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

// ---- {Variabelen} in een .docx opsporen ----

/**
 * Vindt alle {variabelen} in het Word-bestand (hoofdtekst + kop-/voetteksten).
 * Word knipt tekst vaak op in losse stukjes ("runs"); door eerst alle
 * XML-tags weg te strippen plakt de tekst weer aan elkaar en vinden we ook
 * placeholders die over meerdere runs verdeeld zijn.
 */
export function scanDocxPlaceholders(docx: Uint8Array): string[] {
  const files = unzipSync(docx)
  const keys: string[] = []
  const seen = new Set<string>()
  for (const name of Object.keys(files)) {
    if (!/^word\/(document|header\d*|footer\d*)\.xml$/.test(name)) continue
    const plain = strFromU8(files[name]).replace(/<[^>]+>/g, '')
    for (const m of plain.matchAll(/\{([^{}\n]{1,80})\}/g)) {
      const key = m[1].trim()
      if (key && !seen.has(key)) {
        seen.add(key)
        keys.push(key)
      }
    }
  }
  return keys
}

/** Nette label van een veldsleutel: eerste letter per woord groot. */
export function labelFromKey(key: string): string {
  return key.replace(/[_-]+/g, ' ').replace(/\b\p{L}/gu, (c) => c.toUpperCase())
}

// ---- Invullen ----

/**
 * Vult de {variabelen} in het Word-bestand in met de opgegeven waarden en
 * geeft het ingevulde .docx-bestand terug. Gebruikt docxtemplater, dat ook
 * placeholders aankan die Word over meerdere tekst-runs heeft geknipt.
 */
export async function fillDocxTemplate(docx: Uint8Array, values: Record<string, string>): Promise<Uint8Array> {
  const [{ default: Docxtemplater }, { default: PizZip }] = await Promise.all([
    import('docxtemplater'),
    import('pizzip')
  ])
  const zip = new PizZip(docx.slice())
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{', end: '}' },
    // Sleutels mogen spaties en leestekens bevatten ({Adres + huisnummer …});
    // we zoeken de letterlijke tag op in de waarden-map.
    parser: (tag: string) => ({ get: (scope: Record<string, string>) => scope[tag.trim()] ?? scope[tag] ?? '' }),
    nullGetter: () => ''
  })
  doc.render(values)
  const out = doc.getZip().generate({ type: 'uint8array', compression: 'DEFLATE' }) as Uint8Array
  return out
}

/** Past het bestandsnaam-patroon toe: {templatenaam}, {datum}, {volgnummer} en veldsleutels. */
export function applyFilePattern(template: DocTemplate, values: Record<string, string>): string {
  const all = { ...autoValues(template), ...values }
  let name = (template.filePattern || '{templatenaam} {datum}').trim()
  name = name.replace(/\{([^{}]+)\}/g, (_, key: string) => {
    const k = key.trim()
    return all[k] ?? all[k.toLowerCase()] ?? ''
  })
  name = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().replace(/\.$/, '')
  return name || template.name
}

// ---- Waardetransformatie: datum-notatie, bedragen en bedrag-in-woorden ----

const MONTHS_NL = ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december']

/** yyyy-mm-dd (datumveld) → 10-07-2026 of "10 juli 2026". */
export function formatDateNL(iso: string, format: 'kort' | 'lang' = 'kort'): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  const [, y, mo, d] = m
  if (format === 'lang') return `${Number(d)} ${MONTHS_NL[Number(mo) - 1]} ${y}`
  return `${d}-${mo}-${y}`
}

/** "50000" / "50.000,5" / "€ 50.000" → nette euro-notatie "€ 50.000,00". */
export function formatAmountNL(raw: string): string {
  const cleaned = raw.replace(/[€\s]|EUR/gi, '')
  if (!/^-?[\d.,]+$/.test(cleaned)) return raw
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/\.(?=\d{3}(\D|$))/g, '')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return raw
  return `€ ${value.toLocaleString('nl-NL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

const ONES_NL = ['nul', 'een', 'twee', 'drie', 'vier', 'vijf', 'zes', 'zeven', 'acht', 'negen', 'tien', 'elf', 'twaalf', 'dertien', 'veertien', 'vijftien', 'zestien', 'zeventien', 'achttien', 'negentien']
const TENS_NL = ['', '', 'twintig', 'dertig', 'veertig', 'vijftig', 'zestig', 'zeventig', 'tachtig', 'negentig']

function belowHundredNL(n: number): string {
  if (n < 20) return ONES_NL[n]
  const t = Math.floor(n / 10)
  const u = n % 10
  if (!u) return TENS_NL[t]
  const unit = ONES_NL[u]
  return `${unit}${unit.endsWith('e') ? 'ën' : 'en'}${TENS_NL[t]}`
}

function belowThousandNL(n: number): string {
  if (n < 100) return belowHundredNL(n)
  const h = Math.floor(n / 100)
  const rest = n % 100
  const hundred = h === 1 ? 'honderd' : `${ONES_NL[h]}honderd`
  return rest ? `${hundred}${belowHundredNL(rest)}` : hundred
}

/** Geheel getal in Nederlandse woorden (tot miljarden). */
export function numberToWordsNL(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  if (n < 0) return `min ${numberToWordsNL(-n)}`
  if (n < 1000) return belowThousandNL(n)
  const parts: string[] = []
  const miljard = Math.floor(n / 1e9)
  const miljoen = Math.floor((n % 1e9) / 1e6)
  const duizend = Math.floor((n % 1e6) / 1e3)
  const rest = n % 1000
  if (miljard) parts.push(`${miljard === 1 ? 'een' : belowThousandNL(miljard)} miljard`)
  if (miljoen) parts.push(`${miljoen === 1 ? 'een' : belowThousandNL(miljoen)} miljoen`)
  if (duizend) parts.push(duizend === 1 ? 'duizend' : `${belowThousandNL(duizend)}duizend`)
  if (rest) parts.push(belowThousandNL(rest))
  return parts.join(' ')
}

/** Bedrag in woorden: "€ 50.000,00" → "vijftigduizend euro"; met centen erbij. */
export function amountToWordsNL(raw: string): string {
  const cleaned = raw.replace(/[€\s]|EUR/gi, '')
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/\.(?=\d{3}(\D|$))/g, '')
  const value = Number(normalized)
  if (!Number.isFinite(value)) return raw
  const euros = Math.trunc(Math.abs(value))
  const cents = Math.round((Math.abs(value) - euros) * 100)
  const sign = value < 0 ? 'min ' : ''
  const base = `${sign}${numberToWordsNL(euros)} euro`
  return cents ? `${base} en ${numberToWordsNL(cents)} cent` : base
}

/** "50.000,50" / "€ 50.000" / "50000.5" → getal, of null wanneer het geen bedrag is. */
export function parseAmountNL(raw: string): number | null {
  const cleaned = String(raw ?? '').replace(/[€\s]|EUR/gi, '')
  if (!/^-?[\d.,]+$/.test(cleaned)) return null
  const normalized = cleaned.includes(',')
    ? cleaned.replace(/\./g, '').replace(',', '.')
    : cleaned.replace(/\.(?=\d{3}(\D|$))/g, '')
  const value = Number(normalized)
  return Number.isFinite(value) ? value : null
}

/**
 * Zet de ruwe formulier-invoer om naar documentwaarden: berekende velden worden
 * eerst uitgerekend (percentage/som/verschil van andere velden), datums volgen
 * de gekozen notatie, en bedragen (ook berekende) krijgen een nette euro-notatie
 * plus een extra variabele "<sleutel> in woorden".
 */
export function transformValues(template: DocTemplate, values: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = { ...values }
  // Eerst berekenen (in veldvolgorde, zodat een berekend veld op een eerder
  // berekend veld mag bouwen).
  for (const f of template.fields) {
    if (f.type !== 'computed' || !f.formula?.a) continue
    const a = parseAmountNL(out[f.formula.a] ?? '')
    if (a === null) continue
    let result: number | null = null
    if (f.formula.op === 'pct') result = (a * (f.formula.pct ?? 0)) / 100
    else {
      const b = parseAmountNL(out[f.formula.b ?? ''] ?? '')
      if (b !== null) result = f.formula.op === 'sub' ? a - b : a + b
    }
    if (result !== null) out[f.key] = result.toFixed(2).replace('.', ',')
  }
  for (const f of template.fields) {
    const raw = (out[f.key] ?? '').trim()
    if (!raw) continue
    if (f.type === 'date') out[f.key] = formatDateNL(raw, f.dateFormat ?? 'kort')
    if (f.type === 'amount' || f.type === 'computed') {
      out[f.key] = formatAmountNL(raw)
      out[`${f.key} in woorden`] = amountToWordsNL(raw)
    }
  }
  return out
}

// ---- Veldvalidatie ----

function isValidIbanT(raw: string): boolean {
  const iban = raw.replace(/\s+/g, '').toUpperCase()
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{6,30}$/.test(iban)) return false
  const rearranged = iban.slice(4) + iban.slice(0, 4)
  let remainder = 0
  for (const ch of rearranged) {
    const value = /\d/.test(ch) ? ch : (ch.charCodeAt(0) - 55).toString()
    for (const d of value) remainder = (remainder * 10 + Number(d)) % 97
  }
  return remainder === 1
}

/** Controleert een (niet-lege) waarde; geeft een foutmelding of null. */
export function validateFieldValue(field: TemplateField, raw: string): string | null {
  const value = raw.trim()
  if (!value || !field.validation || field.validation === 'none') return null
  switch (field.validation) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) ? null : 'Geen geldig e-mailadres'
    case 'postcode':
      return /^\d{4}\s?[A-Za-z]{2}$/.test(value) ? null : 'Geen geldige postcode (1234 AB)'
    case 'iban':
      return isValidIbanT(value) ? null : 'Geen geldige IBAN'
    case 'kvk':
      return /^\d{8}$/.test(value.replace(/\s/g, '')) ? null : 'Een KVK-nummer bestaat uit 8 cijfers'
    default:
      return null
  }
}

// ---- Klantkaarten: herbruikbare sets ingevulde gegevens ----

export interface ClientCard {
  id: string
  name: string
  values: Record<string, string>
}

const LS_CLIENTS = 'pdf-studio-template-clients'

export function listClients(): ClientCard[] {
  try {
    return JSON.parse(window.localStorage.getItem(LS_CLIENTS) ?? '[]')
  } catch {
    return []
  }
}

export function saveClient(card: ClientCard): void {
  const list = listClients()
  const idx = list.findIndex((c) => c.id === card.id || c.name.toLowerCase() === card.name.toLowerCase())
  if (idx >= 0) list[idx] = { ...card, id: list[idx].id }
  else list.push(card)
  window.localStorage.setItem(LS_CLIENTS, JSON.stringify(list))
}

export function deleteClient(id: string): void {
  window.localStorage.setItem(LS_CLIENTS, JSON.stringify(listClients().filter((c) => c.id !== id)))
}

// ---- Geschiedenis van gegenereerde documenten ----

export interface HistoryEntry {
  when: number
  templateId: string
  templateName: string
  client: string
  volgnummer?: number
  fileName: string
  format: 'docx' | 'pdf'
}

const LS_HISTORY = 'pdf-studio-template-history'

export function listHistory(): HistoryEntry[] {
  try {
    return JSON.parse(window.localStorage.getItem(LS_HISTORY) ?? '[]')
  } catch {
    return []
  }
}

export function addHistory(entry: HistoryEntry): void {
  const list = [entry, ...listHistory()].slice(0, 300)
  window.localStorage.setItem(LS_HISTORY, JSON.stringify(list))
}

export function clearHistory(): void {
  window.localStorage.removeItem(LS_HISTORY)
}

/** Klantlabel voor de geschiedenis: het veld met "klantidentificatie", anders het eerste ingevulde veld. */
export function clientLabel(template: DocTemplate, values: Record<string, string>): string {
  const idField = template.fields.find((f) => f.isClientId && (values[f.key] ?? '').trim())
  if (idField) return values[idField.key].trim()
  const first = template.fields.find((f) => (values[f.key] ?? '').trim())
  return first ? values[first.key].trim() : ''
}

// ---- Bibliotheekmap (gedeelde map voor het hele kantoor) ----

export async function getLibraryInfo(): Promise<{ dir: string; isDefault: boolean } | null> {
  if (typeof window.api?.templatesGetDir !== 'function') return null
  try {
    return await window.api.templatesGetDir()
  } catch {
    return null
  }
}

export async function chooseLibraryDir(): Promise<{ ok: boolean; dir?: string }> {
  if (typeof window.api?.templatesChooseDir !== 'function') return { ok: false }
  return window.api.templatesChooseDir()
}

// ---- Kleine JSON-bestanden in de bibliotheekmap (gedeeld met het kantoor);
// ---- in de browser/test een localStorage-fallback.

async function readAux<T>(name: string, lsKey: string): Promise<T | null> {
  if (typeof window.api?.templatesReadAux === 'function') {
    try {
      const raw = await window.api.templatesReadAux(name)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  }
  try {
    const raw = window.localStorage.getItem(lsKey)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

async function writeAux(name: string, lsKey: string, value: unknown): Promise<void> {
  const json = JSON.stringify(value, null, 1)
  if (typeof window.api?.templatesWriteAux === 'function') {
    await window.api.templatesWriteAux(name, json)
    return
  }
  window.localStorage.setItem(lsKey, json)
}

// ---- Kantoorgegevens: vaste variabelen voor alle sjablonen ----

export type OfficeValues = Record<string, string>

export async function loadOfficeValues(): Promise<OfficeValues> {
  return (await readAux<OfficeValues>('kantoor.json', 'pdf-studio-office-values')) ?? {}
}

export async function saveOfficeValues(values: OfficeValues): Promise<void> {
  await writeAux('kantoor.json', 'pdf-studio-office-values', values)
}

// ---- Documentpakketten: meerdere sjablonen, één invulbeurt ----

export interface DocPack {
  id: string
  name: string
  description?: string
  templateIds: string[]
}

export async function listPacks(): Promise<DocPack[]> {
  return (await readAux<DocPack[]>('pakketten.json', 'pdf-studio-template-packs')) ?? []
}

export async function savePack(pack: DocPack): Promise<void> {
  const list = await listPacks()
  const idx = list.findIndex((p) => p.id === pack.id)
  if (idx >= 0) list[idx] = pack
  else list.push(pack)
  await writeAux('pakketten.json', 'pdf-studio-template-packs', list)
}

export async function deletePack(id: string): Promise<void> {
  await writeAux('pakketten.json', 'pdf-studio-template-packs', (await listPacks()).filter((p) => p.id !== id))
}

/** Gecombineerde invoervelden van een pakket: gedeelde sleutels maar één keer. */
export function packFields(templates: DocTemplate[]): TemplateField[] {
  const seen = new Set<string>()
  const fields: TemplateField[] = []
  for (const t of templates) {
    for (const f of t.fields) {
      if (seen.has(f.key)) continue
      seen.add(f.key)
      fields.push(f)
    }
  }
  return fields
}

// ---- Klantkaarten importeren uit Excel/CSV ----

/**
 * Maakt klantkaarten van een werkblad: eerste rij = kolomkoppen (veldsleutels
 * of labels van je sjablonen, bv. Klantnaam / Klantnummer / Adres klant /
 * Telefoon / E-mail / Bedrijfsnaam), daarna één klant per rij. De kaartnaam
 * komt uit de kolom "Klantnaam"/"Naam"/"Bedrijfsnaam", anders de eerste kolom.
 */
export function clientsFromSheet(rows: string[][]): ClientCard[] {
  if (rows.length < 2) return []
  const header = rows[0].map((h) => String(h ?? '').trim())
  const nameIdx = (() => {
    const lower = header.map((h) => h.toLowerCase())
    for (const candidate of ['klantnaam', 'naam', 'bedrijfsnaam']) {
      const i = lower.indexOf(candidate)
      if (i >= 0) return i
    }
    return 0
  })()
  const cards: ClientCard[] = []
  for (const row of rows.slice(1)) {
    if (!row.some((c) => String(c ?? '').trim())) continue
    const values: Record<string, string> = {}
    header.forEach((h, i) => {
      const v = String(row[i] ?? '').trim()
      if (h && v) values[h] = v
    })
    const name = String(row[nameIdx] ?? '').trim() || Object.values(values)[0] || 'Klant'
    cards.push({ id: `${Date.now()}-${cards.length}-${Math.random().toString(36).slice(2, 8)}`, name, values })
  }
  return cards
}
