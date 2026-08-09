import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { zipSync } from 'fflate'
import { useStudioStore } from '../store'
import { forgetSource, loadSourceFile, renderThumbnail } from '../lib/pdfRender'
import {
  addHistory,
  applyFilePattern,
  autoValues,
  chooseLibraryDir,
  clearDraft,
  clearHistory,
  clientLabel,
  clientsFromSheet,
  deleteClient,
  deletePack,
  deleteTemplate,
  fillDocxTemplate,
  getLibraryInfo,
  isFieldVisible,
  labelFromKey,
  listClients,
  listHistory,
  listPacks,
  listTemplates,
  loadDraft,
  loadOfficeValues,
  loadTemplateDocx,
  packFields,
  saveClient,
  saveDraft,
  saveOfficeValues,
  savePack,
  saveTemplate,
  scanDocxPlaceholders,
  transformValues,
  validateFieldValue,
  type ClientCard,
  type DocPack,
  type DocTemplate,
  type HistoryEntry,
  type OfficeValues,
  type TemplateField
} from '../lib/templates'
import { IconClose, IconTrash } from './icons'
import { useModalDialog } from '../hooks/useModalDialog'

type View =
  | { kind: 'list' }
  | { kind: 'edit'; template: DocTemplate; isNew: boolean }
  | { kind: 'fill'; template: DocTemplate }
  | { kind: 'history' }
  | { kind: 'office' }
  | { kind: 'packedit'; pack: DocPack; isNew: boolean }
  | { kind: 'packfill'; pack: DocPack }

const FIELD_TYPES: { value: TemplateField['type']; label: string }[] = [
  { value: 'text', label: 'Tekst (korte invoer)' },
  { value: 'multiline', label: 'Tekst (meerdere regels)' },
  { value: 'date', label: 'Datum' },
  { value: 'amount', label: 'Bedrag (€)' },
  { value: 'select', label: 'Keuzelijst' },
  { value: 'computed', label: 'Berekend (uit andere velden)' }
]

const VALIDATIONS: { value: NonNullable<TemplateField['validation']>; label: string }[] = [
  { value: 'none', label: 'Geen controle' },
  { value: 'email', label: 'E-mailadres' },
  { value: 'iban', label: 'IBAN' },
  { value: 'postcode', label: 'Postcode' },
  { value: 'kvk', label: 'KVK-nummer' }
]

const FAVS_KEY = 'pdf-studio-template-favorites'

function loadFavs(): Set<string> {
  try {
    return new Set(JSON.parse(window.localStorage.getItem(FAVS_KEY) ?? '[]'))
  } catch {
    return new Set()
  }
}

/**
 * Documentsjablonen: een (gedeelde) bibliotheek van Word-bestanden met
 * {variabelen}, per klant of in bulk invullen, pakketten van meerdere
 * documenten, kantoorgegevens en klantkaarten.
 */
export default function TemplatesDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.templatesDialogOpen)
  const setOpen = useStudioStore((s) => s.setTemplatesDialogOpen)
  const cardRef = useModalDialog<HTMLDivElement>(open, () => setOpen(false))
  const addToast = useStudioStore((s) => s.addToast)
  const importFiles = useStudioStore((s) => s.importFiles)

  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [packs, setPacks] = useState<DocPack[]>([])
  const [office, setOffice] = useState<OfficeValues>({})
  const [libInfo, setLibInfo] = useState<{ dir: string; isDefault: boolean } | null>(null)
  const [search, setSearch] = useState('')
  const [favs, setFavs] = useState<Set<string>>(loadFavs)
  const [view, setView] = useState<View>({ kind: 'list' })
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [clients, setClients] = useState<ClientCard[]>([])
  const [selectedClient, setSelectedClient] = useState('')
  const [showColumnHelp, setShowColumnHelp] = useState(false)
  const [preview, setPreview] = useState<{ srcId: string; urls: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const bulkRef = useRef<HTMLInputElement>(null)
  const clientsRef = useRef<HTMLInputElement>(null)
  const pendingDocxRef = useRef<Uint8Array | null>(null)

  async function refreshLibrary(showToast = false): Promise<void> {
    const [t, p, o, info] = await Promise.all([listTemplates(), listPacks(), loadOfficeValues(), getLibraryInfo()])
    setTemplates(t)
    setPacks(p)
    setOffice(o)
    setLibInfo(info)
    if (showToast) addToast('success', `Bibliotheek vernieuwd — ${t.length} sjablonen, ${p.length} pakketten`)
  }

  // Bij elke opening vers van schijf lezen: nieuwe sjablonen van collega's
  // in de gedeelde map verschijnen dus vanzelf.
  useEffect(() => {
    if (!open) return
    setView({ kind: 'list' })
    setPreview(null)
    setSearch('')
    void refreshLibrary()
    setClients(listClients())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    return () => {
      if (preview) forgetSource(preview.srcId)
    }
  }, [preview])

  if (!open) return null

  function toggleFav(id: string): void {
    setFavs((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      window.localStorage.setItem(FAVS_KEY, JSON.stringify([...next]))
      return next
    })
  }

  function openFill(t: DocTemplate): void {
    const draft = loadDraft(t.id)
    const base: Record<string, string> = {}
    // Kantoorgegevens vooraf invullen voor overeenkomende sleutels.
    for (const f of t.fields) if (office[f.key]) base[f.key] = office[f.key]
    setValues({ ...base, ...(draft ?? {}) })
    if (draft && Object.values(draft).some((v) => v.trim())) addToast('info', 'Eerder opgeslagen concept geladen')
    setSelectedClient('')
    setShowColumnHelp(false)
    setView({ kind: 'fill', template: t })
  }

  function openPackFill(pack: DocPack): void {
    const members = pack.templateIds.map((id) => templates.find((t) => t.id === id)).filter(Boolean) as DocTemplate[]
    if (members.length !== pack.templateIds.length) {
      addToast('error', 'Niet alle sjablonen van dit pakket zijn gevonden in de bibliotheek')
      return
    }
    const fields = packFields(members)
    const draft = loadDraft(`pack:${pack.id}`)
    const base: Record<string, string> = {}
    for (const f of fields) if (office[f.key]) base[f.key] = office[f.key]
    setValues({ ...base, ...(draft ?? {}) })
    setSelectedClient('')
    setView({ kind: 'packfill', pack })
  }

  async function onPickDocx(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const keys = scanDocxPlaceholders(bytes)
      if (!keys.length) {
        addToast('info', 'Geen {variabelen} gevonden in dit Word-bestand — voeg bv. {Klantnaam} toe en probeer opnieuw')
        return
      }
      pendingDocxRef.current = bytes
      const template: DocTemplate = {
        id: nanoid(8),
        name: file.name.replace(/\.docx$/i, ''),
        category: '',
        version: 1,
        filePattern: '{templatenaam} {datum}',
        fields: keys.map((key) => ({ key, label: labelFromKey(key), type: 'text', required: true })),
        createdAt: Date.now()
      }
      setView({ kind: 'edit', template, isNew: true })
    } catch {
      addToast('error', 'Kon het Word-bestand niet lezen — is het een geldig .docx-bestand?')
    }
  }

  async function persistTemplate(template: DocTemplate): Promise<void> {
    const ok = await saveTemplate(template, pendingDocxRef.current)
    if (!ok) {
      addToast('error', 'Sjabloon opslaan is mislukt')
      return
    }
    pendingDocxRef.current = null
    await refreshLibrary()
    setView({ kind: 'list' })
    addToast('success', `Sjabloon "${template.name}" opgeslagen`)
  }

  async function duplicateTemplate(t: DocTemplate): Promise<void> {
    const docx = await loadTemplateDocx(t.id)
    const copy: DocTemplate = { ...t, id: nanoid(8), name: `${t.name} (kopie)`, createdAt: Date.now() }
    await saveTemplate(copy, docx)
    await refreshLibrary()
    addToast('success', `Sjabloon gedupliceerd als "${copy.name}"`)
  }

  async function exportTemplate(t: DocTemplate): Promise<void> {
    const docx = await loadTemplateDocx(t.id)
    if (!docx) {
      addToast('error', 'Het sjabloonbestand is niet gevonden')
      return
    }
    let bin = ''
    for (const b of docx) bin += String.fromCharCode(b)
    const payload = JSON.stringify({ pdfStudioTemplate: 1, meta: t, docx: btoa(bin) }, null, 1)
    const result = await window.api.saveFile(`${t.name}.sjabloon.json`, new TextEncoder().encode(payload), 'json')
    if (result.saved) addToast('success', `Sjabloon geëxporteerd — deel het bestand met een collega`)
  }

  async function onImportTemplate(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const parsed = JSON.parse(await file.text()) as { pdfStudioTemplate?: number; meta?: DocTemplate; docx?: string }
      if (!parsed.pdfStudioTemplate || !parsed.meta || !parsed.docx) throw new Error('geen sjabloon')
      const bin = atob(parsed.docx)
      const docx = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i += 1) docx[i] = bin.charCodeAt(i)
      const meta: DocTemplate = { ...parsed.meta, id: nanoid(8), createdAt: Date.now() }
      await saveTemplate(meta, docx)
      await refreshLibrary()
      addToast('success', `Sjabloon "${meta.name}" geïmporteerd`)
    } catch {
      addToast('error', 'Dit is geen geldig sjabloon-exportbestand (.sjabloon.json)')
    }
  }

  async function onImportClients(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const XLSX = await import('xlsx-js-style')
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }) as string[][]
      const cards = clientsFromSheet(rows)
      if (!cards.length) {
        addToast('info', 'Geen klanten gevonden — eerste rij = kolomkoppen, daarna één klant per rij')
        return
      }
      for (const card of cards) saveClient(card)
      setClients(listClients())
      addToast('success', `${cards.length} klantkaart${cards.length === 1 ? '' : 'en'} geïmporteerd`)
    } catch {
      addToast('error', 'Klanten importeren is mislukt — controleer het Excel-/CSV-bestand')
    }
  }

  function validationErrors(fields: TemplateField[]): Record<string, string> {
    const errors: Record<string, string> = {}
    for (const f of fields) {
      if (f.type === 'computed' || !isFieldVisible(f, values)) continue
      const err = validateFieldValue(f, values[f.key] ?? '')
      if (err) errors[f.key] = err
    }
    return errors
  }

  const requiredMissingIn = (fields: TemplateField[]): TemplateField[] =>
    fields.filter((f) => f.type !== 'computed' && f.required && isFieldVisible(f, values) && !(values[f.key] ?? '').trim())

  async function buildFilled(template: DocTemplate, raw: Record<string, string>): Promise<{ bytes: Uint8Array; base: string }> {
    const docx = await loadTemplateDocx(template.id)
    if (!docx) throw new Error('sjabloon ontbreekt')
    const transformed = transformValues(template, raw)
    const all = { ...autoValues(template), ...office, ...transformed }
    const bytes = await fillDocxTemplate(docx, all)
    const base = applyFilePattern(template, transformed)
    return { bytes, base }
  }

  async function afterGenerate(template: DocTemplate, count = 1): Promise<DocTemplate> {
    clearDraft(template.id)
    if (template.autoNumber) {
      const bumped = { ...template, nextNumber: (template.nextNumber ?? 1) + count }
      await saveTemplate(bumped, null)
      await refreshLibrary()
      return bumped
    }
    return template
  }

  async function generate(template: DocTemplate, format: 'docx' | 'pdf'): Promise<void> {
    setBusy(true)
    try {
      const { bytes: filled, base } = await buildFilled(template, values)
      const entry: HistoryEntry = {
        when: Date.now(),
        templateId: template.id,
        templateName: template.name,
        client: clientLabel(template, values),
        volgnummer: template.autoNumber ? template.nextNumber ?? 1 : undefined,
        fileName: base,
        format
      }
      if (format === 'docx') {
        const result = await window.api.saveFile(`${base}.docx`, filled, 'docx')
        if (result.saved) {
          addToast(
            'success',
            `Document opgeslagen als "${base}.docx"`,
            result.path && typeof window.api.openPath === 'function'
              ? { label: 'Open document', run: () => void window.api.openPath!(result.path!) }
              : undefined
          )
          addHistory(entry)
          setView({ kind: 'fill', template: await afterGenerate(template) })
        }
        return
      }
      const converted = await window.api.convertOffice(`${base}.docx`, filled)
      if (!converted.ok || !converted.data) {
        addToast('error', converted.error ?? 'PDF maken is mislukt — Word-export werkt wel')
        return
      }
      const result = await window.api.savePdf(`${base}.pdf`, new Uint8Array(converted.data))
      if (result.saved) {
        addToast('success', `PDF opgeslagen als "${base}.pdf"`, {
          label: 'Open in PDF Studio',
          run: () => void importFiles([{ name: `${base}.pdf`, data: new Uint8Array(converted.data!) }])
        })
        addHistory(entry)
        setView({ kind: 'fill', template: await afterGenerate(template) })
      }
    } catch {
      addToast('error', 'Document genereren is mislukt')
    } finally {
      setBusy(false)
    }
  }

  /** Pakket genereren: alle documenten in één zip (.docx) of één samengevoegde PDF. */
  async function generatePack(pack: DocPack, format: 'zip' | 'pdf'): Promise<void> {
    const members = pack.templateIds.map((id) => templates.find((t) => t.id === id)).filter(Boolean) as DocTemplate[]
    setBusy(true)
    try {
      const outputs: { base: string; docx: Uint8Array; template: DocTemplate }[] = []
      for (const t of members) {
        const { bytes, base } = await buildFilled(t, values)
        outputs.push({ base, docx: bytes, template: t })
        addHistory({
          when: Date.now(),
          templateId: t.id,
          templateName: t.name,
          client: clientLabel(t, values),
          volgnummer: t.autoNumber ? t.nextNumber ?? 1 : undefined,
          fileName: base,
          format: format === 'zip' ? 'docx' : 'pdf'
        })
      }
      if (format === 'zip') {
        const entries: Record<string, Uint8Array> = {}
        const used = new Set<string>()
        for (const o of outputs) {
          let name = o.base
          let n = 2
          while (used.has(name)) name = `${o.base} (${n++})`
          used.add(name)
          entries[`${name}.docx`] = o.docx
        }
        const result = await window.api.saveZip(`${pack.name}.zip`, zipSync(entries))
        if (!result.saved) return
        addToast('success', `Pakket "${pack.name}": ${outputs.length} documenten in één zip`)
      } else {
        // Elke docx → PDF, daarna samenvoegen tot één bestand.
        const pdfs: Uint8Array[] = []
        for (const o of outputs) {
          const converted = await window.api.convertOffice(`${o.base}.docx`, o.docx)
          if (!converted.ok || !converted.data) {
            addToast('error', converted.error ?? 'PDF maken is mislukt — probeer de zip met Word-bestanden')
            return
          }
          pdfs.push(new Uint8Array(converted.data))
        }
        const { PDFDocument } = await import('@cantoo/pdf-lib')
        const merged = await PDFDocument.create()
        for (const bytes of pdfs) {
          const src = await PDFDocument.load(bytes)
          const pages = await merged.copyPages(src, src.getPageIndices())
          for (const p of pages) merged.addPage(p)
        }
        const bytes = await merged.save()
        const client = members.length ? clientLabel(members[0], values) : ''
        const base = [client, pack.name].filter(Boolean).join(' ')
        const result = await window.api.savePdf(`${base}.pdf`, bytes)
        if (!result.saved) return
        addToast('success', `Pakket "${pack.name}" als één PDF opgeslagen`, {
          label: 'Open in PDF Studio',
          run: () => void importFiles([{ name: `${base}.pdf`, data: bytes }])
        })
      }
      clearDraft(`pack:${pack.id}`)
      // Volgnummers van pakketleden ophogen.
      for (const t of members) {
        if (t.autoNumber) await saveTemplate({ ...t, nextNumber: (t.nextNumber ?? 1) + 1 }, null)
      }
      await refreshLibrary()
    } catch {
      addToast('error', 'Pakket genereren is mislukt')
    } finally {
      setBusy(false)
    }
  }

  async function showPreview(template: DocTemplate): Promise<void> {
    setBusy(true)
    try {
      const { bytes: filled, base } = await buildFilled(template, values)
      const converted = await window.api.convertOffice(`${base}.docx`, filled)
      if (!converted.ok || !converted.data) {
        addToast('error', converted.error ?? 'Voorbeeld vergt PDF-conversie — die is hier niet beschikbaar')
        return
      }
      const srcId = `template-preview-${nanoid(6)}`
      const source = await loadSourceFile(`${base}.pdf`, new Uint8Array(converted.data), srcId)
      const pages = Math.min(source.pageCount, 4)
      const urls: string[] = []
      for (let i = 0; i < pages; i += 1) urls.push(await renderThumbnail(source, i, 0, 900))
      setPreview({ srcId, urls })
    } catch {
      addToast('error', 'Voorbeeld maken is mislukt')
    } finally {
      setBusy(false)
    }
  }

  async function onBulkFile(template: DocTemplate, e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBusy(true)
    try {
      const XLSX = await import('xlsx-js-style')
      const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), { type: 'array' })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' }) as string[][]
      if (rows.length < 2) {
        addToast('info', 'Het bestand heeft geen gegevensrijen (eerste rij = kolomkoppen)')
        return
      }
      const header = rows[0].map((h) => String(h ?? '').trim())
      const keyFor = (h: string): string | null => {
        const lower = h.toLowerCase()
        const f = template.fields.find((x) => x.key.toLowerCase() === lower || x.label.trim().toLowerCase() === lower)
        return f ? f.key : null
      }
      const mapping = header.map(keyFor)
      if (!mapping.some(Boolean)) {
        addToast('error', 'Geen kolomkoppen herkend — gebruik de veldsleutels of labels als koppen (zie Kolomhulp)')
        return
      }
      const zipEntries: Record<string, Uint8Array> = {}
      const usedNames = new Set<string>()
      let made = 0
      const volgStart = template.nextNumber ?? 1
      const docx = await loadTemplateDocx(template.id)
      if (!docx) throw new Error('sjabloon ontbreekt')
      for (const row of rows.slice(1)) {
        if (!row.some((c) => String(c ?? '').trim())) continue
        const rowValues: Record<string, string> = {}
        mapping.forEach((key, i) => {
          if (key) rowValues[key] = String(row[i] ?? '').trim()
        })
        const withNumber = template.autoNumber ? { ...template, nextNumber: volgStart + made } : template
        const transformed = transformValues(template, rowValues)
        const all = { ...autoValues(withNumber), ...office, ...transformed }
        const filled = await fillDocxTemplate(docx, all)
        let base = applyFilePattern(withNumber, transformed)
        let n = 2
        while (usedNames.has(base)) base = `${applyFilePattern(withNumber, transformed)} (${n++})`
        usedNames.add(base)
        zipEntries[`${base}.docx`] = filled
        addHistory({
          when: Date.now(),
          templateId: template.id,
          templateName: template.name,
          client: clientLabel(template, rowValues),
          volgnummer: template.autoNumber ? volgStart + made : undefined,
          fileName: base,
          format: 'docx'
        })
        made += 1
      }
      if (!made) {
        addToast('info', 'Geen ingevulde rijen gevonden')
        return
      }
      const zipped = zipSync(zipEntries)
      const result = await window.api.saveZip(`${template.name} bulk.zip`, zipped)
      if (result.saved) {
        addToast('success', `${made} document${made === 1 ? '' : 'en'} gegenereerd in één zip`)
        if (template.autoNumber) {
          const bumped = { ...template, nextNumber: volgStart + made }
          await saveTemplate(bumped, null)
          await refreshLibrary()
          setView({ kind: 'fill', template: bumped })
        }
      }
    } catch {
      addToast('error', 'Bulk genereren is mislukt — controleer het Excel-/CSV-bestand')
    } finally {
      setBusy(false)
    }
  }

  function applyClient(fields: TemplateField[], clientId: string): void {
    const card = listClients().find((c) => c.id === clientId)
    if (!card) return
    const keys = new Map(fields.map((f) => [f.key.toLowerCase(), f.key]))
    const labels = new Map(fields.map((f) => [f.label.trim().toLowerCase(), f.key]))
    const merged = { ...values }
    for (const [k, v] of Object.entries(card.values)) {
      const target = keys.get(k.toLowerCase()) ?? labels.get(k.toLowerCase())
      if (target && v) merged[target] = v
    }
    setValues(merged)
    addToast('success', `Klantkaart "${card.name}" toegepast`)
  }

  function saveAsClient(template: DocTemplate): void {
    const name = clientLabel(template, values) || 'Klant'
    saveClient({ id: nanoid(8), name, values: { ...values } })
    setClients(listClients())
    addToast('success', `Opgeslagen als klantkaart "${name}"`)
  }

  /** Eén invoerveld van het formulier (gedeeld door sjabloon- en pakket-invullen). */
  function fieldInput(f: TemplateField, syntheticTemplate: DocTemplate, errors: Record<string, string>): JSX.Element {
    const set = (val: string): void => setValues((v) => ({ ...v, [f.key]: val }))
    return (
      <label className="templates-fill__field">
        <span className="templates-fill__label">
          {f.label}
          {f.required && f.type !== 'computed' && <span className="templates-fill__req"> *</span>}
        </span>
        {f.type === 'computed' ? (
          <input
            type="text"
            readOnly
            className="templates-fill__computed"
            value={transformValues(syntheticTemplate, values)[f.key] ?? ''}
            placeholder="wordt automatisch berekend"
            tabIndex={-1}
          />
        ) : f.type === 'multiline' ? (
          <textarea rows={3} placeholder={f.placeholder} value={values[f.key] ?? ''} onChange={(e) => set(e.target.value)} />
        ) : f.type === 'select' ? (
          <select value={values[f.key] ?? ''} onChange={(e) => set(e.target.value)}>
            <option value="">— Kies —</option>
            {(f.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o}
              </option>
            ))}
          </select>
        ) : (
          <input
            type={f.type === 'date' ? 'date' : 'text'}
            placeholder={f.placeholder ?? (f.type === 'amount' ? 'bv. 50.000 of 50000,50' : undefined)}
            value={values[f.key] ?? ''}
            onChange={(e) => set(e.target.value)}
          />
        )}
        {errors[f.key] && <span className="templates-fill__error">{errors[f.key]}</span>}
        {f.help && <span className="templates-fill__hint">{f.help}</span>}
        {f.type === 'amount' && (values[f.key] ?? '').trim() && !errors[f.key] && (
          <span className="templates-fill__hint">
            In document: {transformValues(syntheticTemplate, { [f.key]: values[f.key] })[f.key]} — in woorden beschikbaar
            als {`{${f.key} in woorden}`}
          </span>
        )}
      </label>
    )
  }

  function fillFieldsBlock(fields: TemplateField[], syntheticTemplate: DocTemplate): JSX.Element {
    const errors = validationErrors(fields)
    const visible = fields.filter((f) => isFieldVisible(f, values))
    const requiredVisible = visible.filter((f) => f.required && f.type !== 'computed')
    const filled = requiredVisible.filter((f) => (values[f.key] ?? '').trim()).length
    let lastSection: string | undefined
    return (
      <>
        {visible.map((f) => {
          const heading =
            (f.section ?? '') !== (lastSection ?? '') && f.section ? (
              <div key={`sec-${f.key}`} className="templates-fill__section">
                {f.section}
              </div>
            ) : null
          lastSection = f.section
          return (
            <div key={f.key}>
              {heading}
              {fieldInput(f, syntheticTemplate, errors)}
            </div>
          )
        })}
        <div className="templates-fill__progress">
          {filled} van {requiredVisible.length} verplichte velden ingevuld
        </div>
        {requiredMissingIn(fields).length > 0 && (
          <div className="templates-fill__missing">
            Nog in te vullen: {requiredMissingIn(fields).map((f) => f.label).join(', ')}
          </div>
        )}
        {Object.keys(errors).length > 0 && <div className="templates-fill__missing">Los eerst de gemarkeerde invoerfouten op.</div>}
      </>
    )
  }

  const filteredTemplates = templates.filter((t) => {
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return [t.name, t.category, t.description ?? ''].some((s) => s.toLowerCase().includes(q))
  })
  const favorites = filteredTemplates.filter((t) => favs.has(t.id))
  const byCategory = new Map<string, DocTemplate[]>()
  for (const t of filteredTemplates.filter((t) => !favs.has(t.id))) {
    const cat = t.category.trim() || 'Overig'
    byCategory.set(cat, [...(byCategory.get(cat) ?? []), t])
  }
  const categories = [...byCategory.keys()].sort((a, b) => (a === 'Overig' ? 1 : b === 'Overig' ? -1 : a.localeCompare(b)))

  function templateRow(t: DocTemplate): JSX.Element {
    return (
      <div key={t.id} className="templates-item">
        <button
          type="button"
          className={`templates-item__fav${favs.has(t.id) ? ' templates-item__fav--on' : ''}`}
          title={favs.has(t.id) ? 'Uit favorieten' : 'Markeer als favoriet'}
          onClick={() => toggleFav(t.id)}
        >
          ★
        </button>
        <button type="button" className="templates-item__main" onClick={() => openFill(t)} title="Invullen en genereren">
          <span className="templates-item__name">{t.name}</span>
          <span className="templates-item__meta">
            {[t.category, `${t.fields.length} velden`, `v${t.version}`].filter(Boolean).join(' · ')}
          </span>
        </button>
        <button
          type="button"
          className="pill-btn"
          onClick={() => setView({ kind: 'edit', template: { ...t, fields: t.fields.map((f) => ({ ...f })) }, isNew: false })}
        >
          Bewerken
        </button>
        <button type="button" className="pill-btn" title="Kopie maken" onClick={() => void duplicateTemplate(t)}>
          Dupliceren
        </button>
        <button type="button" className="pill-btn" title="Delen als bestand" onClick={() => void exportTemplate(t)}>
          Exporteren
        </button>
        <button
          type="button"
          className="icon-btn"
          title="Sjabloon verwijderen"
          onClick={() => void deleteTemplate(t.id).then(() => refreshLibrary())}
        >
          <IconTrash size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div ref={cardRef} role="dialog" aria-modal="true" className="modal-card smart-card templates-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__head">
          <h2>
            {view.kind === 'list' && 'Documentsjablonen'}
            {view.kind === 'edit' && (view.isNew ? 'Nieuw sjabloon' : 'Sjabloon bewerken')}
            {view.kind === 'fill' && view.template.name}
            {view.kind === 'history' && 'Geschiedenis'}
            {view.kind === 'office' && 'Kantoorgegevens'}
            {view.kind === 'packedit' && (view.isNew ? 'Nieuw pakket' : 'Pakket bewerken')}
            {view.kind === 'packfill' && view.pack.name}
          </h2>
          <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten" onClick={() => setOpen(false)}>
            <IconClose size={14} />
          </button>
        </div>

        {view.kind === 'list' && (
          <div className="smart-card__body">
            {libInfo && (
              <div className="templates-libbar">
                <span className="templates-libbar__dir" title={libInfo.dir}>
                  Bibliotheek: {libInfo.dir}
                </span>
                <button
                  type="button"
                  className="pill-btn"
                  title="Kies de (gedeelde) map waar de sjablonen staan"
                  onClick={() =>
                    void chooseLibraryDir().then(async (r) => {
                      if (r.ok) {
                        await refreshLibrary()
                        addToast('success', `Bibliotheekmap ingesteld: ${r.dir}`)
                      }
                    })
                  }
                >
                  Map kiezen…
                </button>
                <button type="button" className="pill-btn" title="Bibliotheek opnieuw inlezen" onClick={() => void refreshLibrary(true)}>
                  Vernieuwen
                </button>
              </div>
            )}
            {libInfo?.isDefault && (
              <p className="templates-fill__hint" style={{ marginBottom: 10 }}>
                Tip voor de beheerder: kies één gedeelde (netwerk-)map, dan werkt het hele kantoor uit dezelfde
                bibliotheek. Nieuwe sjablonen van collega's verschijnen automatisch bij het openen of via Vernieuwen.
              </p>
            )}
            <input ref={fileRef} type="file" accept=".docx" hidden onChange={(e) => void onPickDocx(e)} />
            <input ref={importRef} type="file" accept=".json" hidden onChange={(e) => void onImportTemplate(e)} />
            <div className="modal-card__actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap' }}>
              <button type="button" className="pill-btn pill-btn--primary" onClick={() => fileRef.current?.click()}>
                Word-sjabloon toevoegen (.docx)
              </button>
              <button
                type="button"
                className="pill-btn"
                disabled={templates.length === 0}
                title="Meerdere sjablonen bundelen: één invulbeurt, alle documenten in één keer"
                onClick={() => setView({ kind: 'packedit', pack: { id: nanoid(8), name: '', templateIds: [] }, isNew: true })}
              >
                Nieuw pakket
              </button>
              <button type="button" className="pill-btn" onClick={() => importRef.current?.click()}>
                Importeren…
              </button>
              <button type="button" className="pill-btn" onClick={() => setView({ kind: 'office' })}>
                Kantoorgegevens
              </button>
              <button type="button" className="pill-btn" onClick={() => setView({ kind: 'history' })}>
                Geschiedenis
              </button>
            </div>
            {templates.length > 0 && (
              <input
                type="text"
                className="templates-search"
                placeholder="Zoeken op naam, categorie of beschrijving…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            )}
            {packs.length > 0 && (
              <>
                <div className="templates-group">Pakketten</div>
                <div className="templates-list">
                  {packs.map((p) => (
                    <div key={p.id} className="templates-item">
                      <span className="templates-item__fav" style={{ visibility: 'hidden' }}>
                        ★
                      </span>
                      <button type="button" className="templates-item__main" onClick={() => openPackFill(p)} title="Invullen en genereren">
                        <span className="templates-item__name">📦 {p.name}</span>
                        <span className="templates-item__meta">{p.templateIds.length} documenten in één invulbeurt</span>
                      </button>
                      <button type="button" className="pill-btn" onClick={() => setView({ kind: 'packedit', pack: { ...p, templateIds: [...p.templateIds] }, isNew: false })}>
                        Bewerken
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Pakket verwijderen"
                        onClick={() => void deletePack(p.id).then(() => refreshLibrary())}
                      >
                        <IconTrash size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
            {templates.length === 0 ? (
              <p className="templates-empty">
                Nog geen sjablonen. Maak in Word een document met variabelen zoals {'{Klantnaam}'} en {'{Datum}'} en
                voeg het hier toe — de velden worden automatisch herkend.
              </p>
            ) : (
              <>
                {favorites.length > 0 && (
                  <>
                    <div className="templates-group">★ Favorieten</div>
                    <div className="templates-list">{favorites.map(templateRow)}</div>
                  </>
                )}
                {categories.map((cat) => (
                  <div key={cat}>
                    <div className="templates-group">{cat}</div>
                    <div className="templates-list">{(byCategory.get(cat) ?? []).map(templateRow)}</div>
                  </div>
                ))}
                {filteredTemplates.length === 0 && <p className="templates-empty">Geen sjablonen gevonden voor "{search}".</p>}
              </>
            )}
          </div>
        )}

        {view.kind === 'office' && (
          <OfficeEditor
            office={office}
            onCancel={() => setView({ kind: 'list' })}
            onSave={async (next) => {
              await saveOfficeValues(next)
              setOffice(next)
              setView({ kind: 'list' })
              addToast('success', 'Kantoorgegevens opgeslagen — beschikbaar in alle sjablonen')
            }}
          />
        )}

        {view.kind === 'packedit' && (
          <div className="smart-card__body">
            <label className="templates-fill__field">
              <span className="templates-fill__label">Naam *</span>
              <input
                type="text"
                value={view.pack.name}
                placeholder="bv. Dividenduitkering compleet"
                onChange={(e) => setView({ ...view, pack: { ...view.pack, name: e.target.value } })}
              />
            </label>
            <label className="templates-fill__field">
              <span className="templates-fill__label">Beschrijving (optioneel)</span>
              <input
                type="text"
                value={view.pack.description ?? ''}
                onChange={(e) => setView({ ...view, pack: { ...view.pack, description: e.target.value } })}
              />
            </label>
            <div className="templates-edit__fields-title">Sjablonen in dit pakket (gedeelde velden vraag je maar één keer)</div>
            {templates.map((t) => (
              <label key={t.id} className="templates-edit__req" style={{ display: 'flex', marginBottom: 4 }}>
                <input
                  type="checkbox"
                  checked={view.pack.templateIds.includes(t.id)}
                  onChange={(e) =>
                    setView({
                      ...view,
                      pack: {
                        ...view.pack,
                        templateIds: e.target.checked
                          ? [...view.pack.templateIds, t.id]
                          : view.pack.templateIds.filter((id) => id !== t.id)
                      }
                    })
                  }
                />
                {t.name} <span className="templates-item__meta">({t.fields.length} velden)</span>
              </label>
            ))}
            <div className="modal-card__actions">
              <button type="button" className="pill-btn" onClick={() => setView({ kind: 'list' })}>
                Annuleren
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={!view.pack.name.trim() || view.pack.templateIds.length < 2}
                onClick={() =>
                  void savePack({ ...view.pack, name: view.pack.name.trim() }).then(async () => {
                    await refreshLibrary()
                    setView({ kind: 'list' })
                    addToast('success', `Pakket "${view.pack.name.trim()}" opgeslagen`)
                  })
                }
              >
                Pakket opslaan
              </button>
            </div>
          </div>
        )}

        {view.kind === 'packfill' &&
          (() => {
            const members = view.pack.templateIds.map((id) => templates.find((t) => t.id === id)).filter(Boolean) as DocTemplate[]
            const fields = packFields(members)
            const synthetic: DocTemplate = { ...members[0], fields }
            const blocked = busy || requiredMissingIn(fields).length > 0 || Object.keys(validationErrors(fields)).length > 0
            return (
              <div className="smart-card__body">
                {view.pack.description && <p className="smart-card__intro">{view.pack.description}</p>}
                <p className="templates-fill__hint" style={{ marginBottom: 10 }}>
                  Dit pakket genereert {members.length} documenten: {members.map((m) => m.name).join(', ')}.
                </p>
                {fillFieldsBlock(fields, synthetic)}
                <div className="modal-card__actions">
                  <button type="button" className="pill-btn" onClick={() => setView({ kind: 'list' })}>
                    Terug
                  </button>
                  <button
                    type="button"
                    className="pill-btn"
                    onClick={() => {
                      saveDraft(`pack:${view.pack.id}`, values)
                      addToast('success', 'Concept opgeslagen')
                    }}
                  >
                    Concept opslaan
                  </button>
                  <button type="button" className="pill-btn" disabled={blocked} onClick={() => void generatePack(view.pack, 'zip')}>
                    {busy ? 'Bezig…' : 'Word-zip'}
                  </button>
                  <button
                    type="button"
                    className="pill-btn pill-btn--primary"
                    disabled={blocked}
                    onClick={() => void generatePack(view.pack, 'pdf')}
                  >
                    {busy ? 'Bezig…' : 'Eén PDF'}
                  </button>
                </div>
              </div>
            )
          })()}

        {view.kind === 'history' && (
          <div className="smart-card__body">
            {listHistory().length === 0 ? (
              <p className="templates-empty">Nog geen documenten gegenereerd.</p>
            ) : (
              <div className="templates-history">
                {listHistory().map((h, i) => (
                  <div key={i} className="templates-history__row">
                    <span className="templates-history__when">
                      {new Date(h.when).toLocaleDateString('nl-NL')}{' '}
                      {new Date(h.when).toLocaleTimeString('nl-NL', { hour: '2-digit', minute: '2-digit' })}
                    </span>
                    <span className="templates-history__client">{h.client || '—'}</span>
                    <span className="templates-history__tpl">{h.templateName}</span>
                    <span className="templates-history__file">
                      {h.fileName}.{h.format}
                      {h.volgnummer ? ` · nr. ${h.volgnummer}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="modal-card__actions">
              <button type="button" className="pill-btn" onClick={() => setView({ kind: 'list' })}>
                Terug
              </button>
              <button
                type="button"
                className="pill-btn"
                onClick={() => {
                  clearHistory()
                  setView({ kind: 'history' })
                  addToast('success', 'Geschiedenis gewist')
                }}
              >
                Geschiedenis wissen
              </button>
            </div>
          </div>
        )}

        {view.kind === 'edit' && (
          <TemplateEditor
            template={view.template}
            isNew={view.isNew}
            onReplaceDocx={(bytes, keys) => {
              pendingDocxRef.current = bytes
              return keys
            }}
            onCancel={() => {
              pendingDocxRef.current = null
              setView({ kind: 'list' })
            }}
            onSave={(t) => void persistTemplate(t)}
          />
        )}

        {view.kind === 'fill' && (
          <div className="smart-card__body">
            {view.template.description && <p className="smart-card__intro">{view.template.description}</p>}
            <input ref={bulkRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => void onBulkFile(view.template, e)} />
            <input ref={clientsRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => void onImportClients(e)} />
            <div className="templates-clientbar">
              <select value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
                <option value="">— Klantkaart kiezen —</option>
                {clients.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="pill-btn"
                disabled={!selectedClient}
                onClick={() => applyClient(view.template.fields, selectedClient)}
              >
                Toepassen
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Gekozen klantkaart verwijderen"
                disabled={!selectedClient}
                onClick={() => {
                  deleteClient(selectedClient)
                  setClients(listClients())
                  setSelectedClient('')
                }}
              >
                <IconTrash size={13} />
              </button>
              <button
                type="button"
                className="pill-btn"
                title="Bewaar de huidige invulling als herbruikbare klantkaart"
                onClick={() => saveAsClient(view.template)}
              >
                Opslaan als klantkaart
              </button>
              <button
                type="button"
                className="pill-btn"
                title="Klantkaarten importeren uit Excel/CSV (zie Kolomhulp)"
                onClick={() => clientsRef.current?.click()}
              >
                Klanten importeren…
              </button>
              <button
                type="button"
                className="pill-btn"
                title="Genereer één document per rij uit een Excel-/CSV-bestand (zie Kolomhulp)"
                disabled={busy}
                onClick={() => bulkRef.current?.click()}
              >
                Bulk uit Excel…
              </button>
              <button
                type="button"
                className="pill-btn"
                title="Welke kolommen verwacht de import?"
                onClick={() => setShowColumnHelp((v) => !v)}
              >
                ⓘ Kolomhulp
              </button>
            </div>
            {showColumnHelp && (
              <div className="templates-columnhelp">
                <strong>Bulk uit Excel / klanten importeren — zo bouw je het bestand op:</strong>
                <br />• Eerste rij = kolomkoppen; daarna één klant per rij.
                <br />• Kolomkoppen voor dít sjabloon:{' '}
                <code>{view.template.fields.map((f) => f.key).join(' · ')}</code> (labels zoals "
                {view.template.fields[0]?.label}" mogen ook).
                <br />• Voor klantkaarten mag je ook algemene koppen gebruiken (Klantnaam, Klantnummer, Adres,
                Telefoon, E-mail, Bedrijfsnaam …) — bij toepassen worden ze op veldsleutel of label gematcht.
                <br />• De kolom <code>Klantnaam</code> (of Naam/Bedrijfsnaam, anders de eerste kolom) wordt de naam
                van de klantkaart.
              </div>
            )}
            {view.template.autoNumber && (
              <div className="templates-fill__hint" style={{ marginBottom: 8 }}>
                Volgnummer voor dit document: <strong>{view.template.nextNumber ?? 1}</strong> (automatisch)
              </div>
            )}
            {fillFieldsBlock(view.template.fields, view.template)}
            <div className="modal-card__actions">
              <button type="button" className="pill-btn" onClick={() => setView({ kind: 'list' })}>
                Terug
              </button>
              <button
                type="button"
                className="pill-btn"
                title="Bewaar de ingevulde waarden om later verder te gaan"
                onClick={() => {
                  saveDraft(view.template.id, values)
                  addToast('success', 'Concept opgeslagen — je kunt later verdergaan')
                }}
              >
                Concept opslaan
              </button>
              <button type="button" className="pill-btn" disabled={busy} onClick={() => void showPreview(view.template)}>
                {busy ? 'Bezig…' : 'Voorbeeld'}
              </button>
              <button
                type="button"
                className="pill-btn"
                disabled={
                  busy ||
                  requiredMissingIn(view.template.fields).length > 0 ||
                  Object.keys(validationErrors(view.template.fields)).length > 0
                }
                onClick={() => void generate(view.template, 'docx')}
              >
                Word (.docx)
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={
                  busy ||
                  requiredMissingIn(view.template.fields).length > 0 ||
                  Object.keys(validationErrors(view.template.fields)).length > 0
                }
                onClick={() => void generate(view.template, 'pdf')}
              >
                PDF genereren
              </button>
            </div>
          </div>
        )}

        {preview && (
          <div className="templates-preview" onClick={() => setPreview(null)}>
            <div className="templates-preview__inner" onClick={(e) => e.stopPropagation()}>
              <div className="templates-preview__head">
                <span>Voorbeeld (eerste {preview.urls.length} pagina{preview.urls.length === 1 ? '' : "'s"})</span>
                <button type="button" className="icon-btn icon-btn--chrome" onClick={() => setPreview(null)}>
                  <IconClose size={14} />
                </button>
              </div>
              <div className="templates-preview__pages">
                {preview.urls.map((u, i) => (
                  <img key={i} src={u} alt={`Voorbeeldpagina ${i + 1}`} />
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function OfficeEditor({
  office,
  onCancel,
  onSave
}: {
  office: OfficeValues
  onCancel: () => void
  onSave: (next: OfficeValues) => void | Promise<void>
}): JSX.Element {
  const [rows, setRows] = useState<{ key: string; value: string }[]>(() => {
    const entries = Object.entries(office).map(([key, value]) => ({ key, value }))
    return entries.length
      ? entries
      : [
          { key: 'Kantoornaam', value: '' },
          { key: 'Ondertekenaar', value: '' },
          { key: 'Vestigingsplaats', value: '' }
        ]
  })
  return (
    <div className="smart-card__body">
      <p className="smart-card__intro">
        Vaste gegevens van het kantoor, in élk sjabloon beschikbaar als {'{Sleutel}'} — en automatisch vooraf ingevuld
        wanneer een sjabloon een veld met dezelfde sleutel heeft. Eén keer goed instellen, nooit meer de verkeerde
        ondertekenaar.
      </p>
      {rows.map((r, i) => (
        <div key={i} className="templates-office__row">
          <input
            type="text"
            placeholder="Sleutel (bv. Kantoornaam)"
            value={r.key}
            onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, key: e.target.value } : x)))}
          />
          <input
            type="text"
            placeholder="Waarde"
            value={r.value}
            onChange={(e) => setRows((cur) => cur.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))}
          />
          <button type="button" className="icon-btn" title="Regel verwijderen" onClick={() => setRows((cur) => cur.filter((_, j) => j !== i))}>
            <IconTrash size={13} />
          </button>
        </div>
      ))}
      <button type="button" className="pill-btn" onClick={() => setRows((cur) => [...cur, { key: '', value: '' }])}>
        + Regel toevoegen
      </button>
      <div className="modal-card__actions">
        <button type="button" className="pill-btn" onClick={onCancel}>
          Annuleren
        </button>
        <button
          type="button"
          className="pill-btn pill-btn--primary"
          onClick={() => {
            const next: OfficeValues = {}
            for (const r of rows) if (r.key.trim() && r.value.trim()) next[r.key.trim()] = r.value.trim()
            void onSave(next)
          }}
        >
          Opslaan
        </button>
      </div>
    </div>
  )
}

function TemplateEditor({
  template,
  isNew,
  onReplaceDocx,
  onCancel,
  onSave
}: {
  template: DocTemplate
  isNew: boolean
  onReplaceDocx: (bytes: Uint8Array, keys: string[]) => string[]
  onCancel: () => void
  onSave: (t: DocTemplate) => void
}): JSX.Element {
  const addToast = useStudioStore((s) => s.addToast)
  const [t, setT] = useState<DocTemplate>(template)
  const [expanded, setExpanded] = useState<number | null>(null)
  const replaceRef = useRef<HTMLInputElement>(null)
  const patch = (p: Partial<DocTemplate>): void => setT((cur) => ({ ...cur, ...p }))
  const patchField = (i: number, p: Partial<TemplateField>): void =>
    setT((cur) => ({ ...cur, fields: cur.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) }))
  const moveField = (i: number, dir: -1 | 1): void =>
    setT((cur) => {
      const j = i + dir
      if (j < 0 || j >= cur.fields.length) return cur
      const fields = [...cur.fields]
      ;[fields[i], fields[j]] = [fields[j], fields[i]]
      return { ...cur, fields }
    })

  async function onReplaceFile(e: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      const keys = scanDocxPlaceholders(bytes)
      if (!keys.length) {
        addToast('info', 'Geen {variabelen} gevonden in dit Word-bestand')
        return
      }
      onReplaceDocx(bytes, keys)
      setT((cur) => ({
        ...cur,
        version: cur.version + 1,
        fields: keys.map(
          (key) => cur.fields.find((f) => f.key === key) ?? { key, label: labelFromKey(key), type: 'text' as const, required: true }
        )
      }))
      addToast('success', `Word-bestand vervangen — ${keys.length} velden (instellingen behouden), versie verhoogd`)
    } catch {
      addToast('error', 'Kon het Word-bestand niet lezen')
    }
  }

  return (
    <div className="smart-card__body">
      <div className="templates-edit__grid">
        <label className="templates-fill__field">
          <span className="templates-fill__label">Naam *</span>
          <input type="text" value={t.name} onChange={(e) => patch({ name: e.target.value })} />
        </label>
        <label className="templates-fill__field">
          <span className="templates-fill__label">Categorie</span>
          <input type="text" value={t.category} onChange={(e) => patch({ category: e.target.value })} />
        </label>
      </div>
      <div className="templates-edit__grid">
        <label className="templates-fill__field">
          <span className="templates-fill__label">Beschrijving (optioneel)</span>
          <input
            type="text"
            value={t.description ?? ''}
            placeholder="Korte omschrijving voor de gebruiker"
            onChange={(e) => patch({ description: e.target.value })}
          />
        </label>
        <label className="templates-fill__field">
          <span className="templates-fill__label">Versienummer</span>
          <input
            type="number"
            min={1}
            value={t.version}
            onChange={(e) => patch({ version: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
      </div>
      <label className="templates-fill__field">
        <span className="templates-fill__label">Bestandsnaam-patroon</span>
        <input
          type="text"
          value={t.filePattern ?? ''}
          placeholder="{templatenaam} {datum}"
          onChange={(e) => patch({ filePattern: e.target.value })}
        />
        <span className="templates-fill__hint">
          Beschikbare variabelen: veldsleutels zoals {'{Klantnaam}'}, plus {'{datum}'}, {'{templatenaam}'} en{' '}
          {'{volgnummer}'}.
        </span>
      </label>
      <label className="templates-edit__req" style={{ marginBottom: 10 }}>
        <input
          type="checkbox"
          checked={!!t.autoNumber}
          onChange={(e) => patch({ autoNumber: e.target.checked, nextNumber: t.nextNumber ?? 1 })}
        />
        Automatisch volgnummer activeren{' '}
        {t.autoNumber && (
          <>
            — volgende:{' '}
            <input
              type="number"
              min={1}
              className="templates-edit__number"
              value={t.nextNumber ?? 1}
              onChange={(e) => patch({ nextNumber: Math.max(1, Number(e.target.value) || 1) })}
            />
          </>
        )}
      </label>
      {!isNew && (
        <>
          <input ref={replaceRef} type="file" accept=".docx" hidden onChange={(e) => void onReplaceFile(e)} />
          <button type="button" className="pill-btn" style={{ marginBottom: 10 }} onClick={() => replaceRef.current?.click()}>
            Word-bestand vervangen…
          </button>
        </>
      )}

      <div className="templates-edit__fields-title">Invoervelden ({t.fields.length} herkend)</div>
      {t.fields.map((f, i) => (
        <div key={f.key} className="templates-edit__fieldcard">
          <div className="templates-edit__field">
            <span className="templates-edit__order">
              <button type="button" className="icon-btn" title="Omhoog" disabled={i === 0} onClick={() => moveField(i, -1)}>
                ▲
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Omlaag"
                disabled={i === t.fields.length - 1}
                onClick={() => moveField(i, 1)}
              >
                ▼
              </button>
            </span>
            <code className="templates-edit__key">{`{${f.key}}`}</code>
            <input
              type="text"
              value={f.label}
              title="Label (zichtbaar voor de gebruiker)"
              onChange={(e) => patchField(i, { label: e.target.value })}
            />
            <select value={f.type} onChange={(e) => patchField(i, { type: e.target.value as TemplateField['type'] })}>
              {FIELD_TYPES.map((ft) => (
                <option key={ft.value} value={ft.value}>
                  {ft.label}
                </option>
              ))}
            </select>
            <label className="templates-edit__req">
              <input type="checkbox" checked={f.required} onChange={(e) => patchField(i, { required: e.target.checked })} />
              Verplicht
            </label>
            <button
              type="button"
              className="icon-btn"
              title={expanded === i ? 'Minder opties' : 'Meer opties (plaatshouder, sectie, conditie…)'}
              onClick={() => setExpanded((cur) => (cur === i ? null : i))}
            >
              {expanded === i ? '▴' : '▾'}
            </button>
          </div>
          {expanded === i && (
            <div className="templates-edit__more">
              {f.type === 'computed' && (
                <div className="templates-fill__field">
                  <span className="templates-fill__label">Berekening</span>
                  <div className="templates-edit__cond">
                    <select
                      value={f.formula?.op ?? 'pct'}
                      onChange={(e) =>
                        patchField(i, { formula: { op: e.target.value as 'pct' | 'sub' | 'add', a: f.formula?.a ?? '', b: f.formula?.b, pct: f.formula?.pct ?? 15 } })
                      }
                    >
                      <option value="pct">Percentage van een veld</option>
                      <option value="sub">Veld A − veld B</option>
                      <option value="add">Veld A + veld B</option>
                    </select>
                    <select
                      value={f.formula?.a ?? ''}
                      onChange={(e) => patchField(i, { formula: { op: f.formula?.op ?? 'pct', a: e.target.value, b: f.formula?.b, pct: f.formula?.pct ?? 15 } })}
                    >
                      <option value="">— Veld A —</option>
                      {t.fields
                        .filter((o) => o.key !== f.key)
                        .map((o) => (
                          <option key={o.key} value={o.key}>
                            {o.label}
                          </option>
                        ))}
                    </select>
                  </div>
                  <div className="templates-edit__cond" style={{ marginTop: 6 }}>
                    {f.formula?.op === 'pct' ? (
                      <input
                        type="number"
                        step="0.1"
                        value={f.formula?.pct ?? 15}
                        title="Percentage"
                        onChange={(e) => patchField(i, { formula: { op: 'pct', a: f.formula?.a ?? '', pct: Number(e.target.value) } })}
                      />
                    ) : (
                      <select
                        value={f.formula?.b ?? ''}
                        onChange={(e) => patchField(i, { formula: { op: f.formula?.op ?? 'sub', a: f.formula?.a ?? '', b: e.target.value } })}
                      >
                        <option value="">— Veld B —</option>
                        {t.fields
                          .filter((o) => o.key !== f.key)
                          .map((o) => (
                            <option key={o.key} value={o.key}>
                              {o.label}
                            </option>
                          ))}
                      </select>
                    )}
                  </div>
                  <span className="templates-fill__hint">
                    Uitkomst komt als bedrag in het document (bv. 15% dividendbelasting), inclusief {`{${f.key} in woorden}`}.
                  </span>
                </div>
              )}
              {f.type === 'date' && (
                <label className="templates-fill__field">
                  <span className="templates-fill__label">Datumnotatie in document</span>
                  <select
                    value={f.dateFormat ?? 'kort'}
                    onChange={(e) => patchField(i, { dateFormat: e.target.value as 'kort' | 'lang' })}
                  >
                    <option value="kort">10-07-2026</option>
                    <option value="lang">10 juli 2026</option>
                  </select>
                </label>
              )}
              {f.type === 'select' && (
                <label className="templates-fill__field">
                  <span className="templates-fill__label">Opties (één per regel)</span>
                  <textarea
                    rows={3}
                    value={(f.options ?? []).join('\n')}
                    placeholder={'De heer\nMevrouw'}
                    onChange={(e) => patchField(i, { options: e.target.value.split('\n').map((o) => o.trim()).filter(Boolean) })}
                  />
                </label>
              )}
              {f.type === 'amount' && (
                <div className="templates-fill__hint" style={{ marginBottom: 8 }}>
                  Wordt in het document netjes als € 50.000,00 gezet; het bedrag in woorden is beschikbaar als{' '}
                  {`{${f.key} in woorden}`}.
                </div>
              )}
              <div className="templates-edit__grid">
                <label className="templates-fill__field">
                  <span className="templates-fill__label">Plaatshouder (optioneel)</span>
                  <input
                    type="text"
                    value={f.placeholder ?? ''}
                    placeholder="Voorbeeldtekst in het invulveld"
                    onChange={(e) => patchField(i, { placeholder: e.target.value })}
                  />
                </label>
                <label className="templates-fill__field">
                  <span className="templates-fill__label">Toelichting (optioneel)</span>
                  <input
                    type="text"
                    value={f.help ?? ''}
                    placeholder="Extra uitleg onder het veld"
                    onChange={(e) => patchField(i, { help: e.target.value })}
                  />
                </label>
              </div>
              <div className="templates-edit__grid">
                <label className="templates-fill__field">
                  <span className="templates-fill__label">Sectiegroep (optioneel)</span>
                  <input
                    type="text"
                    value={f.section ?? ''}
                    placeholder="bijv. Klantgegevens, Financieel…"
                    onChange={(e) => patchField(i, { section: e.target.value })}
                  />
                </label>
                <label className="templates-fill__field">
                  <span className="templates-fill__label">Invoercontrole</span>
                  <select
                    value={f.validation ?? 'none'}
                    onChange={(e) => patchField(i, { validation: e.target.value as TemplateField['validation'] })}
                  >
                    {VALIDATIONS.map((v) => (
                      <option key={v.value} value={v.value}>
                        {v.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="templates-edit__req">
                <input type="checkbox" checked={!!f.isClientId} onChange={(e) => patchField(i, { isClientId: e.target.checked })} />
                Toon waarde als klantidentificatie in geschiedenis
              </label>
              <label className="templates-edit__req">
                <input type="checkbox" checked={!!f.hidden} onChange={(e) => patchField(i, { hidden: e.target.checked })} />
                Verborgen — variabele beschikbaar in sjabloon maar niet zichtbaar in formulier
              </label>
              <div className="templates-fill__field" style={{ marginTop: 8 }}>
                <span className="templates-fill__label">Zichtbaar als (conditioneel)</span>
                <div className="templates-edit__cond">
                  <select
                    value={f.visibleIf?.key ?? ''}
                    onChange={(e) =>
                      patchField(i, {
                        visibleIf: e.target.value ? { key: e.target.value, equals: f.visibleIf?.equals } : undefined
                      })
                    }
                  >
                    <option value="">— Altijd zichtbaar —</option>
                    {t.fields
                      .filter((o) => o.key !== f.key)
                      .map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                  </select>
                  {f.visibleIf?.key && (
                    <input
                      type="text"
                      value={f.visibleIf.equals ?? ''}
                      placeholder="heeft waarde… (leeg = elk niet-leeg)"
                      onChange={(e) => patchField(i, { visibleIf: { key: f.visibleIf!.key, equals: e.target.value } })}
                    />
                  )}
                </div>
                <span className="templates-fill__hint">
                  Het veld verschijnt alleen als het gekozen veld is ingevuld (of exact de opgegeven waarde heeft).
                </span>
              </div>
            </div>
          )}
        </div>
      ))}

      <div className="modal-card__actions">
        <button type="button" className="pill-btn" onClick={onCancel}>
          Annuleren
        </button>
        <button
          type="button"
          className="pill-btn pill-btn--primary"
          disabled={!t.name.trim()}
          onClick={() => onSave({ ...t, name: t.name.trim(), category: t.category.trim() })}
        >
          Sjabloon opslaan
        </button>
      </div>
    </div>
  )
}
