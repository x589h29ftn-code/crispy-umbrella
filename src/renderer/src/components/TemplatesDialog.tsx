import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import {
  applyFilePattern,
  autoValues,
  clearDraft,
  deleteTemplate,
  fillDocxTemplate,
  isFieldVisible,
  labelFromKey,
  listTemplates,
  loadDraft,
  loadTemplateDocx,
  saveDraft,
  saveTemplate,
  scanDocxPlaceholders,
  type DocTemplate,
  type TemplateField
} from '../lib/templates'
import { IconClose, IconTrash } from './icons'

type View = { kind: 'list' } | { kind: 'edit'; template: DocTemplate; isNew: boolean } | { kind: 'fill'; template: DocTemplate }

const FIELD_TYPES: { value: TemplateField['type']; label: string }[] = [
  { value: 'text', label: 'Tekst (korte invoer)' },
  { value: 'multiline', label: 'Tekst (meerdere regels)' },
  { value: 'date', label: 'Datum' }
]

/**
 * Documentsjablonen: Word-bestanden met {variabelen} als sjabloon opslaan,
 * per klant invullen via een formulier en genereren naar Word of PDF.
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
  const fileRef = useRef<HTMLInputElement>(null)
  const pendingDocxRef = useRef<Uint8Array | null>(null)

  useEffect(() => {
    if (!open) return
    setView({ kind: 'list' })
    void listTemplates().then(setTemplates)
  }, [open])

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

  async function persistTemplate(template: DocTemplate, isNew: boolean): Promise<void> {
    const ok = await saveTemplate(template, isNew ? pendingDocxRef.current : null)
    if (!ok) {
      addToast('error', 'Sjabloon opslaan is mislukt')
      return
    }
    pendingDocxRef.current = null
    setTemplates(await listTemplates())
    setView({ kind: 'list' })
    addToast('success', `Sjabloon "${template.name}" opgeslagen`)
  }

  async function generate(template: DocTemplate, format: 'docx' | 'pdf'): Promise<void> {
    setBusy(true)
    try {
      const docx = await loadTemplateDocx(template.id)
      if (!docx) {
        addToast('error', 'Het sjabloonbestand is niet gevonden')
        return
      }
      // Automatische variabelen ({datum}, {templatenaam}, {volgnummer}) meenemen.
      const allValues = { ...autoValues(template), ...values }
      const filled = await fillDocxTemplate(docx, allValues)
      const base = applyFilePattern(template, values)
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
          await afterGenerate(template)
        }
        return
      }
      // PDF: het ingevulde Word-bestand omzetten (LibreOffice of ingebouwde route).
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
        await afterGenerate(template)
      }
    } catch {
      addToast('error', 'Document genereren is mislukt')
    } finally {
      setBusy(false)
    }
  }

  /** Na een geslaagde generatie: volgnummer ophogen en het concept opruimen. */
  async function afterGenerate(template: DocTemplate): Promise<void> {
    clearDraft(template.id)
    if (template.autoNumber) {
      const bumped = { ...template, nextNumber: (template.nextNumber ?? 1) + 1 }
      await saveTemplate(bumped, null)
      setTemplates(await listTemplates())
      setView({ kind: 'fill', template: bumped })
    }
  }

  // Alleen zichtbare velden tellen mee voor "verplicht".
  const requiredMissing = (template: DocTemplate): TemplateField[] =>
    template.fields.filter((f) => f.required && isFieldVisible(f, values) && !(values[f.key] ?? '').trim())

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card smart-card templates-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__head">
          <h2>
            {view.kind === 'list' && 'Documentsjablonen'}
            {view.kind === 'edit' && (view.isNew ? 'Nieuw sjabloon' : 'Sjabloon bewerken')}
            {view.kind === 'fill' && view.template.name}
          </h2>
          <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten" onClick={() => setOpen(false)}>
            <IconClose size={14} />
          </button>
        </div>

        {view.kind === 'list' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Sla Word-bestanden met <code>{'{variabelen}'}</code> op als sjabloon, vul ze per klant in via een
              formulier en genereer een Word-document of PDF.
            </p>
            <input ref={fileRef} type="file" accept=".docx" hidden onChange={(e) => void onPickDocx(e)} />
            <div className="modal-card__actions" style={{ justifyContent: 'flex-start' }}>
              <button type="button" className="pill-btn pill-btn--primary" onClick={() => fileRef.current?.click()}>
                Word-sjabloon toevoegen (.docx)
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
                      onClick={() => setView({ kind: 'edit', template: { ...t, fields: t.fields.map((f) => ({ ...f })) }, isNew: false })}
                    >
                      Bewerken
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      title="Sjabloon verwijderen"
                      onClick={() => {
                        void deleteTemplate(t.id).then(async () => setTemplates(await listTemplates()))
                      }}
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {view.kind === 'edit' && (
          <TemplateEditor
            template={view.template}
            onCancel={() => setView({ kind: 'list' })}
            onSave={(t) => void persistTemplate(t, view.isNew)}
          />
        )}

        {view.kind === 'fill' && (
          <div className="smart-card__body">
            {view.template.description && <p className="smart-card__intro">{view.template.description}</p>}
            {view.template.autoNumber && (
              <div className="templates-fill__hint" style={{ marginBottom: 8 }}>
                Volgnummer voor dit document: <strong>{view.template.nextNumber ?? 1}</strong> (automatisch)
              </div>
            )}
            {(() => {
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
                    return (
                      <div key={f.key}>
                        {heading}
                        <label className="templates-fill__field">
                          <span className="templates-fill__label">
                            {f.label}
                            {f.required && <span className="templates-fill__req"> *</span>}
                          </span>
                          {f.type === 'multiline' ? (
                            <textarea
                              rows={3}
                              placeholder={f.placeholder}
                              value={values[f.key] ?? ''}
                              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                            />
                          ) : (
                            <input
                              type={f.type === 'date' ? 'date' : 'text'}
                              placeholder={f.placeholder}
                              value={values[f.key] ?? ''}
                              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                            />
                          )}
                          {f.help && <span className="templates-fill__hint">{f.help}</span>}
                        </label>
                      </div>
                    )
                  })}
                  <div className="templates-fill__progress">
                    {filled} van {requiredVisible.length} verplichte velden ingevuld
                  </div>
                </>
              )
            })()}
            {requiredMissing(view.template).length > 0 && (
              <div className="templates-fill__missing">
                Nog in te vullen: {requiredMissing(view.template).map((f) => f.label).join(', ')}
              </div>
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
              <button
                type="button"
                className="pill-btn"
                disabled={busy || requiredMissing(view.template).length > 0}
                onClick={() => void generate(view.template, 'docx')}
              >
                {busy ? 'Bezig…' : 'Word (.docx)'}
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy || requiredMissing(view.template).length > 0}
                onClick={() => void generate(view.template, 'pdf')}
              >
                {busy ? 'Bezig…' : 'PDF genereren'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function TemplateEditor({
  template,
  onCancel,
  onSave
}: {
  template: DocTemplate
  onCancel: () => void
  onSave: (t: DocTemplate) => void
}): JSX.Element {
  const [t, setT] = useState<DocTemplate>(template)
  const [expanded, setExpanded] = useState<number | null>(null)
  const patch = (p: Partial<DocTemplate>): void => setT((cur) => ({ ...cur, ...p }))
  const patchField = (i: number, p: Partial<TemplateField>): void =>
    setT((cur) => ({ ...cur, fields: cur.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) }))

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

      <div className="templates-edit__fields-title">Invoervelden ({t.fields.length} herkend)</div>
      {t.fields.map((f, i) => (
        <div key={f.key} className="templates-edit__fieldcard">
          <div className="templates-edit__field">
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
              <label className="templates-fill__field">
                <span className="templates-fill__label">Sectiegroep (optioneel)</span>
                <input
                  type="text"
                  value={f.section ?? ''}
                  placeholder="bijv. Klantgegevens, Financieel…"
                  onChange={(e) => patchField(i, { section: e.target.value })}
                />
              </label>
              <label className="templates-edit__req">
                <input
                  type="checkbox"
                  checked={!!f.hidden}
                  onChange={(e) => patchField(i, { hidden: e.target.checked })}
                />
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
