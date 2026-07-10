import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { zipSync } from 'fflate'
import { useStudioStore } from '../store'
import { forgetSource, loadSourceFile, renderThumbnail } from '../lib/pdfRender'
import {
  addHistory,
  applyFilePattern,
  autoValues,
  clearDraft,
  clearHistory,
  clientLabel,
  deleteClient,
  deleteTemplate,
  fillDocxTemplate,
  isFieldVisible,
  labelFromKey,
  listClients,
  listHistory,
  listTemplates,
  loadDraft,
  loadTemplateDocx,
  saveClient,
  saveDraft,
  saveTemplate,
  scanDocxPlaceholders,
  transformValues,
  validateFieldValue,
  type ClientCard,
  type DocTemplate,
  type HistoryEntry,
  type TemplateField
} from '../lib/templates'
import { IconClose, IconTrash } from './icons'

type View =
  | { kind: 'list' }
  | { kind: 'edit'; template: DocTemplate; isNew: boolean }
  | { kind: 'fill'; template: DocTemplate }
  | { kind: 'history' }

const FIELD_TYPES: { value: TemplateField['type']; label: string }[] = [
  { value: 'text', label: 'Tekst (korte invoer)' },
  { value: 'multiline', label: 'Tekst (meerdere regels)' },
  { value: 'date', label: 'Datum' },
  { value: 'amount', label: 'Bedrag (€)' },
  { value: 'select', label: 'Keuzelijst' }
]

const VALIDATIONS: { value: NonNullable<TemplateField['validation']>; label: string }[] = [
  { value: 'none', label: 'Geen controle' },
  { value: 'email', label: 'E-mailadres' },
  { value: 'iban', label: 'IBAN' },
  { value: 'postcode', label: 'Postcode' },
  { value: 'kvk', label: 'KVK-nummer' }
]

/**
 * Documentsjablonen: Word-bestanden met {variabelen} als sjabloon opslaan,
 * per klant invullen via een formulier (of in bulk vanuit Excel) en genereren
 * naar Word of PDF — met klantkaarten, voorbeeld en geschiedenis.
 */
export default function TemplatesDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.templatesDialogOpen)
  const setOpen = useStudioStore((s) => s.setTemplatesDialogOpen)
  const addToast = useStudioStore((s) => s.addToast)
  const importFiles = useStudioStore((s) => s.importFiles)

  const [templates, setTemplates] = useState<DocTemplate[]>([])
  const [view, setView] = useState<View>({ kind: 'list' })
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [clients, setClients] = useState<ClientCard[]>([])
  const [selectedClient, setSelectedClient] = useState('')
  const [preview, setPreview] = useState<{ srcId: string; urls: string[] } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const importRef = useRef<HTMLInputElement>(null)
  const bulkRef = useRef<HTMLInputElement>(null)
  const pendingDocxRef = useRef<Uint8Array | null>(null)

  useEffect(() => {
    if (!open) return
    setView({ kind: 'list' })
    setPreview(null)
    void listTemplates().then(setTemplates)
    setClients(listClients())
  }, [open])

  // Voorbeeld-bronnen opruimen bij sluiten/wisselen.
  useEffect(() => {
    return () => {
      if (preview) forgetSource(preview.srcId)
    }
  }, [preview])

  if (!open) return null

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
    setTemplates(await listTemplates())
    setView({ kind: 'list' })
    addToast('success', `Sjabloon "${template.name}" opgeslagen`)
  }

  async function duplicateTemplate(t: DocTemplate): Promise<void> {
    const docx = await loadTemplateDocx(t.id)
    const copy: DocTemplate = { ...t, id: nanoid(8), name: `${t.name} (kopie)`, createdAt: Date.now() }
    await saveTemplate(copy, docx)
    setTemplates(await listTemplates())
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
      setTemplates(await listTemplates())
      addToast('success', `Sjabloon "${meta.name}" geïmporteerd`)
    } catch {
      addToast('error', 'Dit is geen geldig sjabloon-exportbestand (.sjabloon.json)')
    }
  }

  /** Foutmeldingen voor ingevulde maar ongeldige velden (alleen zichtbare). */
  function validationErrors(template: DocTemplate): Record<string, string> {
    const errors: Record<string, string> = {}
    for (const f of template.fields) {
      if (!isFieldVisible(f, values)) continue
      const err = validateFieldValue(f, values[f.key] ?? '')
      if (err) errors[f.key] = err
    }
    return errors
  }

  const requiredMissing = (template: DocTemplate): TemplateField[] =>
    template.fields.filter((f) => f.required && isFieldVisible(f, values) && !(values[f.key] ?? '').trim())

  async function buildFilled(template: DocTemplate, raw: Record<string, string>): Promise<{ bytes: Uint8Array; base: string }> {
    const docx = await loadTemplateDocx(template.id)
    if (!docx) throw new Error('sjabloon ontbreekt')
    const transformed = transformValues(template, raw)
    const all = { ...autoValues(template), ...transformed }
    const bytes = await fillDocxTemplate(docx, all)
    const base = applyFilePattern(template, transformed)
    return { bytes, base }
  }

  async function afterGenerate(template: DocTemplate, count = 1): Promise<DocTemplate> {
    clearDraft(template.id)
    if (template.autoNumber) {
      const bumped = { ...template, nextNumber: (template.nextNumber ?? 1) + count }
      await saveTemplate(bumped, null)
      setTemplates(await listTemplates())
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

  /** Live voorbeeld: huidige invulling → PDF → pagina's als afbeeldingen. */
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

  /** Bulk: Excel/CSV met kolomkoppen = veldsleutels (of labels) → zip met documenten. */
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
      // Kolomkop → veldsleutel (op sleutel of label, hoofdletterongevoelig).
      const header = rows[0].map((h) => String(h ?? '').trim())
      const keyFor = (h: string): string | null => {
        const lower = h.toLowerCase()
        const f = template.fields.find((x) => x.key.toLowerCase() === lower || x.label.trim().toLowerCase() === lower)
        return f ? f.key : null
      }
      const mapping = header.map(keyFor)
      if (!mapping.some(Boolean)) {
        addToast('error', 'Geen kolomkoppen herkend — gebruik de veldsleutels of labels als koppen')
        return
      }
      const zipEntries: Record<string, Uint8Array> = {}
      const usedNames = new Set<string>()
      let made = 0
      let volgStart = template.nextNumber ?? 1
      for (const row of rows.slice(1)) {
        if (!row.some((c) => String(c ?? '').trim())) continue
        const rowValues: Record<string, string> = {}
        mapping.forEach((key, i) => {
          if (key) rowValues[key] = String(row[i] ?? '').trim()
        })
        const withNumber = template.autoNumber ? { ...template, nextNumber: volgStart + made } : template
        const transformed = transformValues(template, rowValues)
        const all = { ...autoValues(withNumber), ...transformed }
        const docx = await loadTemplateDocx(template.id)
        if (!docx) throw new Error('sjabloon ontbreekt')
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
          setTemplates(await listTemplates())
          setView({ kind: 'fill', template: bumped })
        }
      }
    } catch {
      addToast('error', 'Bulk genereren is mislukt — controleer het Excel-/CSV-bestand')
    } finally {
      setBusy(false)
    }
  }

  function applyClient(template: DocTemplate, clientId: string): void {
    const card = listClients().find((c) => c.id === clientId)
    if (!card) return
    const keys = new Set(template.fields.map((f) => f.key))
    const merged = { ...values }
    for (const [k, v] of Object.entries(card.values)) if (keys.has(k) && v) merged[k] = v
    setValues(merged)
    addToast('success', `Klantkaart "${card.name}" toegepast`)
  }

  function saveAsClient(template: DocTemplate): void {
    const name = clientLabel(template, values) || 'Klant'
    saveClient({ id: nanoid(8), name, values: { ...values } })
    setClients(listClients())
    addToast('success', `Opgeslagen als klantkaart "${name}"`)
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card smart-card templates-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__head">
          <h2>
            {view.kind === 'list' && 'Documentsjablonen'}
            {view.kind === 'edit' && (view.isNew ? 'Nieuw sjabloon' : 'Sjabloon bewerken')}
            {view.kind === 'fill' && view.template.name}
            {view.kind === 'history' && 'Geschiedenis'}
          </h2>
          <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten" onClick={() => setOpen(false)}>
            <IconClose size={14} />
          </button>
        </div>

        {view.kind === 'list' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Sla Word-bestanden met <code>{'{variabelen}'}</code> op als sjabloon, vul ze per klant in via een
              formulier (of in bulk vanuit Excel) en genereer een Word-document of PDF.
            </p>
            <input ref={fileRef} type="file" accept=".docx" hidden onChange={(e) => void onPickDocx(e)} />
            <input ref={importRef} type="file" accept=".json" hidden onChange={(e) => void onImportTemplate(e)} />
            <div className="modal-card__actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="pill-btn pill-btn--primary" onClick={() => fileRef.current?.click()}>
                Word-sjabloon toevoegen (.docx)
              </button>
              <button type="button" className="pill-btn" onClick={() => importRef.current?.click()}>
                Importeren…
              </button>
              <button type="button" className="pill-btn" onClick={() => setView({ kind: 'history' })}>
                Geschiedenis
              </button>
            </div>
            {templates.length === 0 ? (
              <p className="templates-empty">
                Nog geen sjablonen. Maak in Word een document met variabelen zoals {'{Klantnaam}'} en {'{Datum}'} en
                voeg het hier toe — de velden worden automatisch herkend.
              </p>
            ) : (
              <div className="templates-list">
                {templates.map((t) => (
                  <div key={t.id} className="templates-item">
                    <button
                      type="button"
                      className="templates-item__main"
                      onClick={() => {
                        const draft = loadDraft(t.id)
                        setValues(draft ?? {})
                        if (draft && Object.values(draft).some((v) => v.trim())) {
                          addToast('info', 'Eerder opgeslagen concept geladen')
                        }
                        setSelectedClient('')
                        setView({ kind: 'fill', template: t })
                      }}
                      title="Invullen en genereren"
                    >
                      <span className="templates-item__name">{t.name}</span>
                      <span className="templates-item__meta">
                        {[t.category, `${t.fields.length} velden`, `v${t.version}`].filter(Boolean).join(' · ')}
                      </span>
                    </button>
                    <button
                      type="button"
                      className="pill-btn"
                      onClick={() =>
                        setView({ kind: 'edit', template: { ...t, fields: t.fields.map((f) => ({ ...f })) }, isNew: false })
                      }
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
                      onClick={() => void deleteTemplate(t.id).then(async () => setTemplates(await listTemplates()))}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
            <input
              ref={bulkRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              hidden
              onChange={(e) => void onBulkFile(view.template, e)}
            />
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
                onClick={() => applyClient(view.template, selectedClient)}
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
                title="Genereer één document per rij uit een Excel-/CSV-bestand (kolomkoppen = veldsleutels of labels)"
                disabled={busy}
                onClick={() => bulkRef.current?.click()}
              >
                Bulk uit Excel…
              </button>
            </div>
            {view.template.autoNumber && (
              <div className="templates-fill__hint" style={{ marginBottom: 8 }}>
                Volgnummer voor dit document: <strong>{view.template.nextNumber ?? 1}</strong> (automatisch)
              </div>
            )}
            {(() => {
              const errors = validationErrors(view.template)
              const visible = view.template.fields.filter((f) => isFieldVisible(f, values))
              const requiredVisible = visible.filter((f) => f.required)
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
                    const set = (val: string): void => setValues((v) => ({ ...v, [f.key]: val }))
                    return (
                      <div key={f.key}>
                        {heading}
                        <label className="templates-fill__field">
                          <span className="templates-fill__label">
                            {f.label}
                            {f.required && <span className="templates-fill__req"> *</span>}
                          </span>
                          {f.type === 'multiline' ? (
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
                              In document: {transformValues(view.template, { [f.key]: values[f.key] })[f.key]} — in woorden
                              beschikbaar als {`{${f.key} in woorden}`}
                            </span>
                          )}
                        </label>
                      </div>
                    )
                  })}
                  <div className="templates-fill__progress">
                    {filled} van {requiredVisible.length} verplichte velden ingevuld
                  </div>
                  {requiredMissing(view.template).length > 0 && (
                    <div className="templates-fill__missing">
                      Nog in te vullen: {requiredMissing(view.template).map((f) => f.label).join(', ')}
                    </div>
                  )}
                  {Object.keys(errors).length > 0 && (
                    <div className="templates-fill__missing">Los eerst de gemarkeerde invoerfouten op.</div>
                  )}
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
                      disabled={busy || requiredMissing(view.template).length > 0 || Object.keys(errors).length > 0}
                      onClick={() => void generate(view.template, 'docx')}
                    >
                      Word (.docx)
                    </button>
                    <button
                      type="button"
                      className="pill-btn pill-btn--primary"
                      disabled={busy || requiredMissing(view.template).length > 0 || Object.keys(errors).length > 0}
                      onClick={() => void generate(view.template, 'pdf')}
                    >
                      PDF genereren
                    </button>
                  </div>
                </>
              )
            })()}
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
      // Instellingen van bestaande sleutels behouden; nieuwe sleutels toevoegen;
      // verdwenen sleutels vervallen. Versienummer gaat automatisch omhoog.
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
