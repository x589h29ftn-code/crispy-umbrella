import { useEffect, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore, type SmartTab } from '../store'
import { extractFields, getGroupText, suggestName, DOC_TYPE_LABELS } from '../lib/docAnalysis'
import { cleanupScannedPage, hasTextLayer, isBlankPage } from '../lib/scanTools'
import { exportDataToCsv } from '../lib/dataExport'
import { exportTablesToXlsx } from '../lib/tableExport'
import { exportGroupText } from '../lib/textExport'
import { getGroupBookmarks } from '../lib/bookmarks'
import { getTextLineBoxes } from '../lib/textLines'
import { analyzeDocument, DEFAULT_STRUCTURE_OPTIONS, type Block } from '../lib/docStructure'
import ScanNotice from './ScanNotice'
import type { DocGroup } from '../types'
import { useModalDialog } from '../hooks/useModalDialog'
import {
  IconArchive,
  IconCalendar,
  IconClose,
  IconCompress,
  IconEditText,
  IconFile,
  IconGridView,
  IconHash,
  IconMarkdown,
  IconScissors,
  IconSparkles,
  IconTrash,
  IconType,
  IconWatermark
} from './icons'
import CompressPanel from './CompressPanel'
import WatermarkPanel from './WatermarkPanel'
import NumberFormatPicker from './NumberFormatPicker'
import MarkdownPanel from './MarkdownPanel'

type Tab = SmartTab

/**
 * "Slimme documenten": automatisch hernoemen op inhoud, lege pagina's vinden en
 * verwijderen, gescande pagina's opschonen, en de kerngegevens naar CSV.
 */
export default function SmartDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.smartDialogOpen)
  const setOpen = useStudioStore((s) => s.setSmartDialogOpen)
  const cardRef = useModalDialog<HTMLDivElement>(open, () => setOpen(false))
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const renameGroup = useStudioStore((s) => s.renameGroup)
  const deletePages = useStudioStore((s) => s.deletePages)
  const applyCleanedPages = useStudioStore((s) => s.applyCleanedPages)
  const splitGroupIntoSegments = useStudioStore((s) => s.splitGroupIntoSegments)
  const reorderGroupPages = useStudioStore((s) => s.reorderGroupPages)
  const addToast = useStudioStore((s) => s.addToast)

  const [tab, setTab] = useState<Tab>('rename')
  const requestedTab = useStudioStore((s) => s.smartDialogTab)

  // Vanuit een documentkaart kan dit venster direct op "Splitsen" openen.
  useEffect(() => {
    if (open && requestedTab) setTab(requestedTab)
  }, [open, requestedTab])
  const [busy, setBusy] = useState(false)
  const [rawPages, setRawPages] = useState(false)
  const [cleanTextPages, setCleanTextPages] = useState(false)
  const [suggestions, setSuggestions] = useState<{ groupId: string; current: string; type: string; suggested: string }[]>([])
  const [blanks, setBlanks] = useState<{ pageId: string; groupName: string; pageNumber: number }[]>([])
  const [blankSelected, setBlankSelected] = useState<Set<string>>(new Set())
  const [segments, setSegments] = useState<{ name: string; pageIds: string[]; firstPage: number }[]>([])
  /** Waar wordt op gesplitst: bladwijzers, herkende hoofdstukken, aantal pagina's of lege scheidingsbladen. */
  const [splitMode, setSplitMode] = useState<'bookmarks' | 'chapters' | 'every' | 'blank'>('bookmarks')
  const [splitEvery, setSplitEvery] = useState(1)
  /** Uitleg als een manier van splitsen niets oplevert. */
  const [splitNote, setSplitNote] = useState('')

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? groups[0]

  useEffect(() => {
    if (!open) {
      setSuggestions([])
      setBlanks([])
      setSegments([])
      setBusy(false)
      setTab('rename')
    }
  }, [open])

  // Splitsen: de gekozen manier omzetten in segmenten (voorbeeld + toepassen).
  useEffect(() => {
    if (!open || tab !== 'split' || !activeGroup) return
    const group = activeGroup
    let cancelled = false
    setBusy(true)
    setSplitNote('')

    /** Snijpunten (paginanummer + titel) omzetten in segmenten. */
    const toSegments = (cuts: { title: string; index: number }[]): typeof segments => {
      const segs: typeof segments = []
      if (cuts.length < 2) return segs
      // Pagina's vóór het eerste snijpunt (voorblad, inhoudsopgave) horen ook
      // ergens bij — zonder dit eerste segment verdwenen ze bij het splitsen,
      // omdat het oorspronkelijke document vervangen wordt.
      if (cuts[0].index > 0) {
        segs.push({
          name: cuts[0].index === 1 ? 'Voorblad' : `Voorwerk (pagina 1-${cuts[0].index})`,
          firstPage: 1,
          pageIds: group.pages.slice(0, cuts[0].index).map((p) => p.id)
        })
      }
      for (let i = 0; i < cuts.length; i += 1) {
        const start = cuts[i].index
        const end = i + 1 < cuts.length ? cuts[i + 1].index : group.pages.length
        segs.push({
          name: cuts[i].title,
          firstPage: start + 1,
          pageIds: group.pages.slice(start, end).map((p) => p.id)
        })
      }
      return segs
    }

    ;(async () => {
      let segs: typeof segments = []
      let note = ''

      if (splitMode === 'bookmarks') {
        const bms = await getGroupBookmarks(group, sources).catch(() => [])
        const idxOf = new Map(group.pages.map((p, i) => [p.id, i]))
        const cuts = bms
          .filter((b) => b.depth === 0 && idxOf.has(b.pageId))
          .map((b) => ({ title: b.title, index: idxOf.get(b.pageId)! }))
          .sort((a, b) => a.index - b.index)
        segs = toSegments(cuts)
        if (!segs.length) {
          note =
            'Dit document heeft geen bruikbare inhoudsopgave. Probeer "Per hoofdstuk": dan zoeken we de koppen in de tekst zelf.'
        }
      } else if (splitMode === 'chapters') {
        // Koppen uit de tekst zelf: lettergrootte, vet en de bladwijzers samen.
        const { pages } = await analyzeDocument(
          group,
          sources,
          { ...DEFAULT_STRUCTURE_OPTIONS, lists: false, tables: false },
          group.name
        )
        // Alleen een kop bovenaan de pagina begint een nieuw hoofdstuk; een
        // tussenkopje halverwege de pagina knipt het document niet.
        const leading: { title: string; index: number; level: number }[] = []
        pages.forEach((blocks, index) => {
          const at = blocks.findIndex((b) => b.kind === 'heading')
          const block = at >= 0 && at <= 1 ? blocks[at] : null
          if (block && block.kind === 'heading') {
            leading.push({ title: block.text.slice(0, 80), index, level: block.level })
          }
        })
        // Welk kopniveau zijn de hoofdstukken? Het hoogste niveau dat minstens
        // twee keer bovenaan een pagina staat. De titel op het voorblad is
        // meestal de énige van niveau 1 — dan zijn de hoofdstukken een niveau
        // dieper, en die willen we hebben.
        const perLevel = new Map<number, number>()
        for (const head of leading) perLevel.set(head.level, (perLevel.get(head.level) ?? 0) + 1)
        const chapterLevel = [...perLevel.entries()]
          .filter(([, count]) => count >= 2)
          .map(([level]) => level)
          .sort((a, b) => a - b)[0]
        // Een kop van een hoger niveau (bv. "Deel A") knipt ook.
        const cuts =
          chapterLevel === undefined ? [] : leading.filter((h) => h.level <= chapterLevel).sort((a, b) => a.index - b.index)
        segs = toSegments(cuts)
        if (!segs.length) {
          note = leading.length
            ? 'Er staat maar één kop bovenaan een pagina — dan valt er niets op te knippen. Probeer splitsen per aantal pagina’s.'
            : "Geen koppen bovenaan een pagina gevonden. Bij een scan zonder tekstlaag kun je splitsen per aantal pagina's."
        }
      } else if (splitMode === 'every') {
        const step = Math.max(1, Math.min(group.pages.length, Math.round(splitEvery) || 1))
        for (let start = 0; start < group.pages.length; start += step) {
          const slice = group.pages.slice(start, start + step)
          const last = start + slice.length
          segs.push({
            name:
              slice.length === 1 ? `${group.name} - pagina ${start + 1}` : `${group.name} - pagina ${start + 1}-${last}`,
            firstPage: start + 1,
            pageIds: slice.map((p) => p.id)
          })
        }
        if (segs.length < 2) note = "Met dit aantal pagina's blijft het één document."
      } else {
        // Lege pagina's als scheidingsblad: de blanco pagina zelf valt weg.
        const blanks = new Set<number>()
        for (let i = 0; i < group.pages.length; i += 1) {
          const page = group.pages[i]
          const source = sources.get(page.sourceId)
          if (!source) continue
          if (await isBlankPage(source, page).catch(() => false)) blanks.add(i)
        }
        if (cancelled) return
        let part: string[] = []
        let firstPage = 1
        const push = (): void => {
          if (part.length) segs.push({ name: `${group.name} - deel ${segs.length + 1}`, firstPage, pageIds: part })
          part = []
        }
        for (let i = 0; i < group.pages.length; i += 1) {
          if (blanks.has(i)) {
            push()
            firstPage = i + 2
            continue
          }
          if (!part.length) firstPage = i + 1
          part.push(group.pages[i].id)
        }
        push()
        if (segs.length < 2) {
          note = blanks.size
            ? 'Er is maar één lege pagina aan het begin of einde gevonden — dat levert geen aparte delen op.'
            : 'Geen lege pagina’s gevonden om op te splitsen.'
        }
      }

      if (!cancelled) {
        setSegments(segs)
        setSplitNote(segs.length >= 2 ? '' : note)
        setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, tab, activeGroup, sources, splitMode, splitEvery])

  useEffect(() => {
    if (!open || tab !== 'rename') return
    let cancelled = false
    setBusy(true)
    ;(async () => {
      const out: typeof suggestions = []
      for (const group of groups) {
        const text = await getGroupText(group, sources)
        const fields = extractFields(text)
        // De eerste kop van het document is vaak de beste naam ("Jaarrekening 2025").
        const structure = await analyzeDocument(group, sources, DEFAULT_STRUCTURE_OPTIONS).catch(() => null)
        const heading = structure?.pages
          .flat()
          .find((b): b is Extract<Block, { kind: 'heading' }> => b.kind === 'heading')?.text
        out.push({
          groupId: group.id,
          current: group.name,
          type: DOC_TYPE_LABELS[fields.type],
          suggested: suggestName(fields, group.name, heading)
        })
      }
      if (!cancelled) {
        setSuggestions(out)
        setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, tab, groups, sources])

  useEffect(() => {
    if (!open || tab !== 'blank') return
    let cancelled = false
    setBusy(true)
    ;(async () => {
      const found: typeof blanks = []
      for (const group of groups) {
        for (let i = 0; i < group.pages.length; i += 1) {
          const page = group.pages[i]
          const source = sources.get(page.sourceId)
          if (!source) continue
          if (await isBlankPage(source, page).catch(() => false)) {
            found.push({ pageId: page.id, groupName: group.name, pageNumber: i + 1 })
          }
        }
      }
      if (!cancelled) {
        setBlanks(found)
        setBlankSelected(new Set(found.map((b) => b.pageId))) // standaard alles aangevinkt
        setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, tab, groups, sources])

  if (!open) return null

  function applyRename(groupId: string, name: string): void {
    renameGroup(groupId, name)
    setSuggestions((prev) => prev.map((s) => (s.groupId === groupId ? { ...s, current: name } : s)))
    addToast('success', `Hernoemd naar "${name}"`)
  }

  function applyAllRenames(): void {
    for (const s of suggestions) if (s.suggested !== s.current) renameGroup(s.groupId, s.suggested)
    setSuggestions((prev) => prev.map((s) => ({ ...s, current: s.suggested })))
    addToast('success', 'Alle documenten hernoemd')
    setOpen(false)
  }

  function removeBlanks(): void {
    const ids = blanks.map((b) => b.pageId).filter((id) => blankSelected.has(id))
    if (!ids.length) return
    deletePages(ids)
    addToast('success', `${ids.length} lege pagina('s) verwijderd`)
    setBlanks([])
    setOpen(false)
  }

  function toggleBlank(pageId: string): void {
    setBlankSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pageId)) next.delete(pageId)
      else next.add(pageId)
      return next
    })
  }

  async function cleanup(group: DocGroup, options: { deskew: boolean; contrast: boolean }): Promise<void> {
    setBusy(true)
    try {
      const entries: { pageId: string; source: import('../types').SourceFile }[] = []
      let skippedText = 0
      let unchanged = 0
      for (const page of group.pages) {
        const source = sources.get(page.sourceId)
        if (!source) continue
        // Opschonen maakt van een pagina een afbeelding. Bij een pagina met een
        // echte tekstlaag kost dat de doorzoekbaarheid én kwaliteit, dus die
        // slaan we over tenzij je er uitdrukkelijk om vraagt.
        if (!cleanTextPages && (await hasTextLayer(source, page).catch(() => false))) {
          skippedText += 1
          continue
        }
        const result = await cleanupScannedPage(source, page, options, nanoid()).catch(() => null)
        if (result) entries.push({ pageId: page.id, source: result.source })
        else unchanged += 1
      }
      if (entries.length) {
        applyCleanedPages(entries)
        const extra = [
          skippedText ? `${skippedText} met tekstlaag overgeslagen` : '',
          unchanged ? `${unchanged} was al recht` : ''
        ].filter(Boolean)
        addToast('success', `${entries.length} pagina('s) opgeschoond${extra.length ? ` — ${extra.join(', ')}` : ''}`)
        setOpen(false)
      } else if (skippedText) {
        addToast(
          'info',
          `Alle ${skippedText} pagina('s) hebben een tekstlaag en zijn overgeslagen — opschonen is voor scans. Vink "Ook pagina's met tekst" aan om het toch te doen.`
        )
      } else {
        addToast('info', 'Er viel niets op te schonen: de pagina’s staan al recht.')
      }
    } finally {
      setBusy(false)
    }
  }

  function applySplit(): void {
    if (!activeGroup || segments.length < 2) return
    splitGroupIntoSegments(activeGroup.id, segments.map((s) => ({ name: s.name, pageIds: s.pageIds })))
    addToast('success', `Gesplitst in ${segments.length} documenten`)
    setOpen(false)
  }

  async function sortByDate(group: DocGroup): Promise<void> {
    setBusy(true)
    try {
      const dated: { pageId: string; date: string | null; index: number }[] = []
      for (let i = 0; i < group.pages.length; i += 1) {
        const page = group.pages[i]
        const source = sources.get(page.sourceId)
        let date: string | null = null
        if (source) {
          const lines = await getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [])
          date = extractFields(lines.map((l) => l.str).join('\n')).date
        }
        dated.push({ pageId: page.id, date, index: i })
      }
      // Pagina's met datum vooraan op datum gesorteerd; zonder datum in oorspronkelijke volgorde erna.
      const withDate = dated.filter((d) => d.date).sort((a, b) => (a.date! < b.date! ? -1 : a.date! > b.date! ? 1 : a.index - b.index))
      const withoutDate = dated.filter((d) => !d.date)
      const order = [...withDate, ...withoutDate].map((d) => d.pageId)
      reorderGroupPages(group.id, order)
      addToast('success', withDate.length ? `Gesorteerd op datum (${withDate.length} met datum)` : 'Geen datums gevonden om op te sorteren')
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  const TOOL_GROUPS: {
    title: string
    tools: { key: Tab; label: string; hint: string; icon: JSX.Element; blocked?: string }[]
  }[] = [
    {
      title: 'Ordenen',
      tools: [
        {
          key: 'rename',
          label: 'Hernoemen',
          hint: 'Naam voorstellen op basis van de inhoud',
          icon: <IconEditText size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        },
        {
          key: 'sort',
          label: 'Sorteren',
          hint: "Pagina's op datum zetten",
          icon: <IconCalendar size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        },
        {
          key: 'split',
          label: 'Splitsen',
          hint: 'Per hoofdstuk, bladwijzer of aantal pagina’s',
          icon: <IconScissors size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        },
        {
          key: 'portfolio',
          label: 'Dossier bundelen',
          hint: 'Alle documenten in één PDF met inhoudsopgave',
          icon: <IconArchive size={15} />,
          blocked: groups.length >= 2 ? undefined : 'Hiervoor zijn minstens twee documenten nodig'
        }
      ]
    },
    {
      title: 'Opschonen',
      tools: [
        {
          key: 'blank',
          label: "Lege pagina's",
          hint: 'Lege scans opsporen en verwijderen',
          icon: <IconFile size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        },
        {
          key: 'cleanup',
          label: 'Scans opschonen',
          hint: 'Grijssluier weg, tekst zwarter',
          icon: <IconSparkles size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        },
        {
          key: 'compress',
          label: 'Comprimeren',
          hint: 'Kleiner maken om te mailen',
          icon: <IconCompress size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        }
      ]
    },
    {
      title: 'Afwerken',
      tools: [
        {
          key: 'watermark',
          label: 'Watermerk',
          hint: 'CONCEPT of eigen tekst over de pagina',
          icon: <IconWatermark size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        }
      ]
    },
    {
      title: 'Eruit halen',
      tools: [
        {
          key: 'markdown',
          label: 'Markdown',
          hint: 'Opgemaakte tekst als .md',
          icon: <IconMarkdown size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        },
        {
          key: 'text',
          label: 'Tekst / Word',
          hint: 'Als .txt, .docx of .rtf',
          icon: <IconType size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        },
        {
          key: 'table',
          label: 'Tabel → Excel',
          hint: 'Herkende tabellen naar .xlsx',
          icon: <IconGridView size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        },
        {
          key: 'data',
          label: 'Gegevens → CSV',
          hint: 'Datum, bedrag en afzender per document',
          icon: <IconHash size={15} />,
          blocked: activeGroup ? undefined : 'Open eerst een document'
        }
      ]
    }
  ]

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div ref={cardRef} role="dialog" aria-modal="true" className="modal-card smart-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn icon-btn--chrome smart-card__close" title="Sluiten" onClick={() => setOpen(false)}>
          <IconClose size={13} />
        </button>
        <h3>Slimme documenten</h3>
        <p className="smart-card__lead">
          Gereedschap voor het actieve document{activeGroup ? ` — "${activeGroup.name}"` : ''}.
        </p>

        <div className="smart-layout">
          <nav className="smart-rail" aria-label="Gereedschap">
            {TOOL_GROUPS.map((group) => (
              <div key={group.title} className="smart-rail__group">
                <div className="smart-rail__group-title">{group.title}</div>
                {group.tools.map((tool) => (
                  <button
                    key={tool.key}
                    type="button"
                    className={`smart-rail__item${tab === tool.key ? ' smart-rail__item--active' : ''}`}
                    disabled={Boolean(tool.blocked)}
                    title={tool.blocked ?? tool.hint}
                    aria-current={tab === tool.key}
                    onClick={() => setTab(tool.key)}
                  >
                    <span className="smart-rail__icon">{tool.icon}</span>
                    <span className="smart-rail__text">
                      <span className="smart-rail__label">{tool.label}</span>
                      <span className="smart-rail__hint">{tool.blocked ?? tool.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            ))}
          </nav>

          <div className="smart-panel">
        {(['table', 'data', 'text', 'sort', 'rename'] as Tab[]).includes(tab) && <ScanNotice group={activeGroup} />}

        {tab === 'rename' && (
          <div className="smart-card__body">
            {busy ? (
              <p>Documenten analyseren…</p>
            ) : (
              <>
                <p className="smart-card__intro">Voorgestelde namen op basis van de inhoud (type, datum, afzender).</p>
                <div className="smart-card__list">
                  {suggestions.map((s) => (
                    <div key={s.groupId} className="smart-rename">
                      <span className="smart-rename__type">{s.type}</span>
                      <input
                        className="smart-rename__input"
                        value={s.suggested}
                        onChange={(e) =>
                          setSuggestions((prev) => prev.map((x) => (x.groupId === s.groupId ? { ...x, suggested: e.target.value } : x)))
                        }
                      />
                      <button type="button" className="pill-btn pill-btn--sm" onClick={() => applyRename(s.groupId, s.suggested)}>
                        Toepassen
                      </button>
                    </div>
                  ))}
                </div>
                <div className="modal-card__actions">
                  <button type="button" className="pill-btn pill-btn--primary" onClick={applyAllRenames}>
                    Alles hernoemen
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'blank' && (
          <div className="smart-card__body">
            {busy ? (
              <p>Zoeken naar lege pagina's…</p>
            ) : blanks.length === 0 ? (
              <p>Geen lege pagina's gevonden.</p>
            ) : (
              <>
                <p className="smart-card__intro">
                  {blanks.length} lege pagina('s) gevonden. Vink aan welke je wilt verwijderen:
                </p>
                <div className="smart-card__list">
                  {blanks.map((b) => (
                    <label key={b.pageId} className="smart-blank smart-blank--check">
                      <input type="checkbox" checked={blankSelected.has(b.pageId)} onChange={() => toggleBlank(b.pageId)} />
                      <IconFile size={13} /> {b.groupName} · pagina {b.pageNumber}
                    </label>
                  ))}
                </div>
                <div className="modal-card__actions">
                  <button
                    type="button"
                    className="pill-btn"
                    onClick={() =>
                      setBlankSelected((prev) =>
                        prev.size === blanks.length ? new Set() : new Set(blanks.map((b) => b.pageId))
                      )
                    }
                  >
                    {blankSelected.size === blanks.length ? 'Niets selecteren' : 'Alles selecteren'}
                  </button>
                  <button
                    type="button"
                    className="pill-btn pill-btn--primary"
                    disabled={blankSelected.size === 0}
                    onClick={removeBlanks}
                  >
                    <IconTrash size={14} /> {blankSelected.size} verwijderen
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'cleanup' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Schoont de gescande pagina's van "{activeGroup?.name ?? '—'}" op: rechtzetten en achtergrond witter /
              tekst zwarter maken. De pagina wordt daarbij een afbeelding, dus pagina's met een echte tekstlaag slaan
              we over — die blijven scherp en doorzoekbaar.
            </p>
            <label className="prefs-check">
              <input type="checkbox" checked={cleanTextPages} onChange={(e) => setCleanTextPages(e.target.checked)} />
              <span>
                <span className="prefs-row__title">Ook pagina’s met tekst opschonen</span>
                <span className="prefs-row__hint">
                  Alleen doen bij een slecht ingescand document; de tekstlaag (zoeken, kopiëren, export) gaat verloren.
                </span>
              </span>
            </label>
            <div className="modal-card__actions">
              <button
                type="button"
                className="pill-btn"
                disabled={busy || !activeGroup}
                onClick={() => activeGroup && void cleanup(activeGroup, { deskew: true, contrast: false })}
              >
                Alleen rechtzetten
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy || !activeGroup}
                onClick={() => activeGroup && void cleanup(activeGroup, { deskew: true, contrast: true })}
              >
                {busy ? 'Bezig…' : 'Rechtzetten + opschonen'}
              </button>
            </div>
          </div>
        )}

        {tab === 'data' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Herkent per document de kerngegevens (type, datum, factuurnummer, bedrag, IBAN, afzender) en zet ze in een
              CSV-bestand dat je in Excel opent.
            </p>
            <div className="modal-card__actions">
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                onClick={() => {
                  setOpen(false)
                  void exportDataToCsv()
                }}
              >
                Exporteren naar CSV
              </button>
            </div>
          </div>
        )}

        {tab === 'split' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">Waar wil je "{activeGroup?.name ?? '—'}" op knippen?</p>
            <div className="split-modes">
              {(
                [
                  ['bookmarks', 'Op bladwijzers', 'De inhoudsopgave van de PDF'],
                  ['chapters', 'Per hoofdstuk', 'Koppen in de tekst zelf herkennen'],
                  ['every', "Per aantal pagina's", 'Vaste blokken, bv. elke pagina apart'],
                  ['blank', 'Bij lege pagina’s', 'Blanco scheidingsbladen als grens']
                ] as const
              ).map(([mode, label, hint]) => (
                <button
                  key={mode}
                  type="button"
                  className={`split-mode${splitMode === mode ? ' split-mode--active' : ''}`}
                  title={hint}
                  onClick={() => setSplitMode(mode)}
                >
                  <span className="split-mode__label">{label}</span>
                  <span className="split-mode__hint">{hint}</span>
                </button>
              ))}
            </div>
            {splitMode === 'every' && (
              <label className="split-every">
                <span>Aantal pagina's per document</span>
                <input
                  type="number"
                  className="prefs-input split-every__input"
                  min={1}
                  max={Math.max(1, (activeGroup?.pages.length ?? 1) - 1)}
                  value={splitEvery}
                  onChange={(e) => setSplitEvery(Math.max(1, Number(e.target.value) || 1))}
                />
              </label>
            )}
            {busy ? (
              <p>
                {splitMode === 'bookmarks'
                  ? 'Bladwijzers zoeken…'
                  : splitMode === 'chapters'
                    ? 'Koppen zoeken in de tekst…'
                    : splitMode === 'blank'
                      ? 'Lege pagina’s zoeken…'
                      : 'Indeling maken…'}
              </p>
            ) : segments.length < 2 ? (
              <p>{splitNote || 'Op deze manier valt dit document niet te splitsen.'}</p>
            ) : (
              <>
                <p className="smart-card__intro">Dit worden {segments.length} documenten:</p>
                <div className="smart-card__list">
                  {segments.map((s, i) => (
                    <div key={i} className="smart-blank">
                      <IconFile size={13} /> {s.name} · {s.pageIds.length} pagina('s) (vanaf p. {s.firstPage})
                    </div>
                  ))}
                </div>
                <div className="modal-card__actions">
                  <button type="button" className="pill-btn pill-btn--primary" onClick={applySplit}>
                    Splitsen in {segments.length} documenten
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'sort' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Zet de pagina's van "{activeGroup?.name ?? '—'}" op volgorde van de datum die op elke pagina wordt
              herkend. Pagina's zonder datum blijven achteraan in de huidige volgorde.
            </p>
            <div className="modal-card__actions">
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy || !activeGroup}
                onClick={() => activeGroup && void sortByDate(activeGroup)}
              >
                {busy ? 'Bezig…' : 'Sorteren op datum'}
              </button>
            </div>
          </div>
        )}

        {tab === 'compress' && <CompressPanel />}

        {tab === 'watermark' && <WatermarkPanel />}

        {tab === 'markdown' && <MarkdownPanel group={activeGroup} />}

        {tab === 'portfolio' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Bundelt alle geopende documenten ({groups.length}) tot één dossier-PDF met een voorblad, een
              inhoudsopgave met paginanummers en een scheidingsblad per document.
            </p>
            <div className="modal-card__actions">
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy || groups.length < 2}
                onClick={() => {
                  setBusy(true)
                  void import('../lib/portfolio')
                    .then((m) => m.exportPortfolio())
                    .finally(() => {
                      setBusy(false)
                      setOpen(false)
                    })
                }}
              >
                {busy ? 'Bezig…' : `Dossier bundelen (${groups.length} documenten)`}
              </button>
            </div>
          </div>
        )}

        {tab === 'table' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Zoekt de tabellen in "{activeGroup?.name ?? '—'}" (rijen en kolommen op basis van de tekstposities) en
              zet elke tabel op een eigen werkblad, genoemd naar het kopje erboven. Bedragen, percentages en datums
              komen als échte waarden binnen. Werkt op de tekstlaag; voor scans eerst OCR draaien.
            </p>
            <NumberFormatPicker />
            <label className="prefs-check">
              <input type="checkbox" checked={rawPages} onChange={(e) => setRawPages(e.target.checked)} />
              <span>
                <span className="prefs-row__title">Ook pagina’s zonder herkende tabel meenemen</span>
                <span className="prefs-row__hint">
                  Zet die pagina’s als ruw raster op een eigen werkblad — handig als een tabel niet herkend wordt.
                </span>
              </span>
            </label>
            <div className="modal-card__actions">
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy || !activeGroup}
                onClick={() => {
                  setBusy(true)
                  void exportTablesToXlsx({ includeRawPages: rawPages })
                    .then((r) => {
                      // saveWorkbook toont zelf de melding met "Open Excel-bestand"-knop.
                      if (r.ok) setOpen(false)
                      else addToast('error', r.reason ?? 'Exporteren naar Excel is mislukt')
                    })
                    .finally(() => setBusy(false))
                }}
              >
                {busy ? 'Bezig…' : 'Exporteren naar Excel (.xlsx)'}
              </button>
            </div>
          </div>
        )}

        {tab === 'text' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Haalt de tekst uit "{activeGroup?.name ?? '—'}". Het Word-document krijgt echte kopstijlen,
              opsommingen en tabellen; .txt en .rtf zijn platte tekst.
            </p>
            <NumberFormatPicker />
            <div className="modal-card__actions">
              <button
                type="button"
                className="pill-btn"
                onClick={() => {
                  setOpen(false)
                  void exportGroupText('txt')
                }}
              >
                Als tekst (.txt)
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                onClick={() => {
                  setOpen(false)
                  void import('../lib/wordExport').then((m) => m.exportGroupWord())
                }}
              >
                Als Word (.docx)
              </button>
              <button type="button" className="pill-btn" onClick={() => setTab('markdown')}>
                Als Markdown (.md)…
              </button>
              <button
                type="button"
                className="pill-btn"
                onClick={() => {
                  setOpen(false)
                  void exportGroupText('rtf')
                }}
              >
                Word-compatibel (.rtf)
              </button>
            </div>
          </div>
        )}
          </div>
        </div>
      </div>
    </div>
  )
}
