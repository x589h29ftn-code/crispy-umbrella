import { useEffect, useMemo, useState } from 'react'
import { useStudioStore } from '../store'
import { useModalDialog } from '../hooks/useModalDialog'
import { IconClose } from './icons'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Documenteigenschappen: titel, auteur, onderwerp, trefwoorden en de
 * documentdatum. Deze gegevens komen bij het opslaan echt in de PDF terecht
 * (Bestand → Eigenschappen in Acrobat) en zijn waar een DMS of het archief op
 * zoekt. Onderaan staat wat het document zelf is: pagina's, bronbestanden en
 * grootte.
 */
export default function DocPropertiesDialog(): JSX.Element | null {
  const groupId = useStudioStore((s) => s.docPropertiesGroupId)
  const setOpen = useStudioStore((s) => s.setDocPropertiesOpen)
  const cardRef = useModalDialog<HTMLDivElement>(groupId !== null, () => setOpen(null))
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const setGroupProperties = useStudioStore((s) => s.setGroupProperties)
  const setGroupDocumentDate = useStudioStore((s) => s.setGroupDocumentDate)
  const renameGroup = useStudioStore((s) => s.renameGroup)
  const authorName = useStudioStore((s) => s.authorName)
  const pdfaExport = useStudioStore((s) => s.pdfaExport)
  const setPdfaExport = useStudioStore((s) => s.setPdfaExport)
  const addToast = useStudioStore((s) => s.addToast)

  const group = groups.find((g) => g.id === groupId) ?? null

  const [name, setName] = useState('')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [subject, setSubject] = useState('')
  const [keywords, setKeywords] = useState('')
  const [date, setDate] = useState('')

  // Bij het openen de huidige waarden in de velden zetten. Zonder eigen auteur
  // stellen we de naam uit Voorkeuren voor — dat is bijna altijd de bedoeling.
  useEffect(() => {
    if (!group) return
    const props = group.properties ?? {}
    setName(group.name)
    setTitle(props.title ?? '')
    setAuthor(props.author ?? authorName)
    setSubject(props.subject ?? '')
    setKeywords((props.keywords ?? []).join(', '))
    setDate(group.documentDate ?? '')
  }, [groupId, group, authorName])

  const info = useMemo(() => {
    if (!group) return null
    const used = [...new Set(group.pages.map((p) => p.sourceId))]
      .map((id) => sources.get(id))
      .filter((s): s is NonNullable<typeof s> => Boolean(s))
    return {
      pages: group.pages.length,
      files: used.map((s) => s.name),
      bytes: used.reduce((sum, s) => sum + s.data.byteLength, 0),
      annotations: group.pages.reduce((n, p) => n + p.annotations.filter((a) => a.type !== 'field').length, 0),
      fields: group.pages.reduce((n, p) => n + p.annotations.filter((a) => a.type === 'field').length, 0),
      comments: group.pages.reduce((n, p) => n + p.comments.length, 0)
    }
  }, [group, sources])

  if (groupId === null || !group || !info) return null

  function apply(): void {
    if (!group) return
    setGroupProperties(group.id, {
      title: title.trim() || undefined,
      author: author.trim() || undefined,
      subject: subject.trim() || undefined,
      keywords: keywords
        .split(/[,;]/)
        .map((k) => k.trim())
        .filter(Boolean)
    })
    setGroupDocumentDate(group.id, date || null)
    if (name.trim() && name.trim() !== group.name) renameGroup(group.id, name.trim())
    addToast('success', 'Documenteigenschappen opgeslagen — ze komen in de PDF bij het opslaan')
    setOpen(null)
  }

  return (
    <div className="modal-overlay" onClick={() => setOpen(null)}>
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        className="modal-card prefs-card docprops-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-card__header">
          <h3>Documenteigenschappen</h3>
          <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten (Esc)" onClick={() => setOpen(null)}>
            <IconClose size={14} />
          </button>
        </div>
        <p className="smart-card__lead">
          Deze gegevens worden bij het opslaan in de PDF gezet (in Acrobat: Bestand → Eigenschappen). Handig voor het
          archief en voor zoeken in een DMS.
        </p>

        <label className="docprops-field">
          <span className="prefs-row__title">Documentnaam (in PDF Studio)</span>
          <input type="text" className="prefs-input" value={name} onChange={(e) => setName(e.target.value)} />
          <span className="prefs-row__hint">Ook de voorgestelde bestandsnaam bij opslaan.</span>
        </label>

        <label className="docprops-field">
          <span className="prefs-row__title">Titel</span>
          <input
            type="text"
            className="prefs-input"
            placeholder={group.name}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
          <span className="prefs-row__hint">Leeg = de documentnaam wordt als titel gebruikt.</span>
        </label>

        <label className="docprops-field">
          <span className="prefs-row__title">Auteur</span>
          <input
            type="text"
            className="prefs-input"
            placeholder="Bijv. Otto Visser &amp; Partners"
            value={author}
            onChange={(e) => setAuthor(e.target.value)}
          />
        </label>

        <label className="docprops-field">
          <span className="prefs-row__title">Onderwerp</span>
          <input
            type="text"
            className="prefs-input"
            placeholder="Bijv. Jaarrekening 2025"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </label>

        <label className="docprops-field">
          <span className="prefs-row__title">Trefwoorden</span>
          <input
            type="text"
            className="prefs-input"
            placeholder="jaarrekening, 2025, definitief"
            value={keywords}
            onChange={(e) => setKeywords(e.target.value)}
          />
          <span className="prefs-row__hint">Scheiden met een komma.</span>
        </label>

        <label className="docprops-field">
          <span className="prefs-row__title">Documentdatum</span>
          <input type="date" className="prefs-input" value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="prefs-row__hint">Wordt de aanmaak- en wijzigingsdatum van de PDF.</span>
        </label>

        <label className="prefs-check">
          <input type="checkbox" checked={pdfaExport} onChange={(e) => setPdfaExport(e.target.checked)} />
          <span>
            <span className="prefs-row__title">Opslaan als PDF/A (archief)</span>
            <span className="prefs-row__hint">
              PDF/A-2b: alle tekst die PDF Studio toevoegt wordt met een ingebed lettertype geschreven, er komt een
              sRGB-kleurprofiel in het bestand en de eigenschappen hierboven worden ook als XMP-metadata opgenomen.
              Lettertypen die in het geopende bestand zelf niet zijn ingebed kunnen we niet toevoegen, en een
              wachtwoord is niet mogelijk. Deze stand geldt voor alle exports tot je hem uitzet.
            </span>
          </span>
        </label>

        <div className="docprops-info">
          <div>
            <span className="prefs-row__title">Inhoud</span>
            <span className="prefs-row__hint">
              {info.pages} {info.pages === 1 ? 'pagina' : "pagina's"} · {info.annotations} markering(en) ·{' '}
              {info.fields} invulveld(en) · {info.comments} opmerking(en)
            </span>
          </div>
          <div>
            <span className="prefs-row__title">Bronbestanden</span>
            <span className="prefs-row__hint">
              {info.files.length ? info.files.join(', ') : '—'} ({formatBytes(info.bytes)})
            </span>
          </div>
        </div>

        <div className="modal-card__actions">
          <button type="button" className="pill-btn" onClick={() => setOpen(null)}>
            Annuleren
          </button>
          <button type="button" className="pill-btn pill-btn--primary" onClick={apply}>
            Opslaan
          </button>
        </div>
      </div>
    </div>
  )
}
