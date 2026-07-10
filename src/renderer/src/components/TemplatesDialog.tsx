import { useEffect, useRef, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import {
  applyFilePattern,
  deleteTemplate,
  fillDocxTemplate,
  labelFromKey,
  listTemplates,
  loadTemplateDocx,
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
      const filled = await fillDocxTemplate(docx, values)
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
      }
    } catch {
      addToast('error', 'Document genereren is mislukt')
    } finally {
      setBusy(false)
    }
  }

  const requiredMissing = (template: DocTemplate): TemplateField[] =>
    template.fields.filter((f) => f.required && !(values[f.key] ?? '').trim())

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
                        setValues({})
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
            {view.template.fields.map((f) => (
              <label key={f.key} className="templates-fill__field">
                <span className="templates-fill__label">
                  {f.label}
                  {f.required && <span className="templates-fill__req"> *</span>}
                </span>
                {f.type === 'multiline' ? (
                  <textarea
                    rows={3}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                ) : (
                  <input
                    type={f.type === 'date' ? 'date' : 'text'}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  />
                )}
              </label>
            ))}
            <div className="templates-fill__progress">
              {view.template.fields.filter((f) => f.required && (values[f.key] ?? '').trim()).length} van{' '}
              {view.template.fields.filter((f) => f.required).length} verplichte velden ingevuld
            </div>
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
      <label className="templates-fill__field">
        <span className="templates-fill__label">Bestandsnaam-patroon</span>
        <input
          type="text"
          value={t.filePattern ?? ''}
          placeholder="{templatenaam} {datum}"
          onChange={(e) => patch({ filePattern: e.target.value })}
        />
        <span className="templates-fill__hint">
          Beschikbare variabelen: veldsleutels zoals {'{Klantnaam}'}, plus {'{datum}'} en {'{templatenaam}'}.
        </span>
      </label>

      <div className="templates-edit__fields-title">Invoervelden ({t.fields.length} herkend)</div>
      {t.fields.map((f, i) => (
        <div key={f.key} className="templates-edit__field">
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
