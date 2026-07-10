import { unzipSync, strFromU8 } from 'fflate'

/** Een invoerveld van een sjabloon; de sleutel = de {variabele} in het Word-bestand. */
export interface TemplateField {
  key: string
  label: string
  type: 'text' | 'multiline' | 'date'
  required: boolean
}

export interface DocTemplate {
  id: string
  name: string
  category: string
  description?: string
  version: number
  /** Bestandsnaam-patroon, bv. "{Klantnaam} {datum} {templatenaam}". */
  filePattern?: string
  fields: TemplateField[]
  createdAt: number
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

/** Past het bestandsnaam-patroon toe: {templatenaam}, {datum} en veldsleutels. */
export function applyFilePattern(template: DocTemplate, values: Record<string, string>): string {
  const d = new Date()
  const datum = `${d.getDate()}-${d.getMonth() + 1}-${d.getFullYear()}`
  let name = (template.filePattern || '{templatenaam} {datum}').trim()
  name = name.replace(/\{templatenaam\}/gi, template.name).replace(/\{datum\}/gi, datum)
  name = name.replace(/\{([^{}]+)\}/g, (_, key: string) => values[key.trim()] ?? '')
  name = name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim().replace(/\.$/, '')
  return name || template.name
}
