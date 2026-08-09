import { useEffect, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore, type SmartTab } from '../store'
import { extractFields, getGroupText, suggestName, DOC_TYPE_LABELS } from '../lib/docAnalysis'
import { cleanupScannedPage, isBlankPage } from '../lib/scanTools'
import { exportDataToCsv } from '../lib/dataExport'
import { exportTablesToXlsx } from '../lib/tableExport'
import { exportGroupText } from '../lib/textExport'
import { getGroupBookmarks } from '../lib/bookmarks'
import { getTextLineBoxes } from '../lib/textLines'
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
  IconType
} from './icons'
import CompressPanel from './CompressPanel'
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
  const [suggestions, setSuggestions] = useState<{ groupId: string; current: string; type: string; suggested: string }[]>([])
  const [blanks, setBlanks] = useState<{ pageId: string; groupName: string; pageNumber: number }[]>([])
  const [blankSelected, setBlankSelected] = useState<Set<string>>(new Set())
  const [segments, setSegments] = useState<{ name: string; pageIds: string[]; firstPage: number }[]>([])

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

  // Splitsen: top-niveau bladwijzers van het actieve document → segmenten.
  useEffect(() => {
    if (!open || tab !== 'split' || !activeGroup) return
    let cancelled = false
    setBusy(true)
    ;(async () => {
      const bms = await getGroupBookmarks(activeGroup, sources).catch(() => [])
      const idxOf = new Map(activeGroup.pages.map((p, i) => [p.id, i]))
      const cuts = bms
        .filter((b) => b.depth === 0 && idxOf.has(b.pageId))
        .map((b) => ({ title: b.title, index: idxOf.get(b.pageId)! }))
        .sort((a, b) => a.index - b.index)
      const segs: typeof segments = []
      if (cuts.length >= 2) {
        for (let i = 0; i < cuts.length; i += 1) {
          const start = cuts[i].index
          const end = i + 1 < cuts.length ? cuts[i + 1].index : activeGroup.pages.length
          segs.push({
            name: cuts[i].title,
            firstPage: start + 1,
            pageIds: activeGroup.pages.slice(start, end).map((p) => p.id)
          })
        }
      }
      if (!cancelled) {
        setSegments(segs)
        setBusy(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, tab, activeGroup, sources])

  useEffect(() => {
    if (!open || tab !== 'rename') return
    let cancelled = false
    setBusy(true)
    ;(async () => {
      const out: typeof suggestions = []
      for (const group of groups) {
        const text = await getGroupText(group, sources)
        const fields = extractFields(text)
        out.push({ groupId: group.id, current: group.name, type: DOC_TYPE_LABELS[fields.type], suggested: suggestName(fields, group.name) })
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
      for (const page of group.pages) {
        const source = sources.get(page.sourceId)
        if (!source) continue
        const result = await cleanupScannedPage(source, page, options, nanoid()).catch(() => null)
        if (result) entries.push({ pageId: page.id, source: result.source })
      }
      if (entries.length) {
        applyCleanedPages(entries)
        addToast('success', `${entries.length} pagina('s) opgeschoond`)
      } else {
        addToast('error', 'Opschonen is niet gelukt')
      }
      setOpen(false)
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
          hint: 'Opknippen langs de inhoudsopgave',
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
              Schoont de pagina's van "{activeGroup?.name ?? '—'}" op: rechtzetten en achtergrond witter / tekst
              zwarter maken. Handig voor gescande stukken.
            </p>
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
            {busy ? (
              <p>Bladwijzers zoeken…</p>
            ) : segments.length < 2 ? (
              <p>
                Dit document heeft geen bruikbare inhoudsopgave om op te splitsen. Bij het samenvoegen van meerdere
                bestanden krijgt een document automatisch bladwijzers per bron.
              </p>
            ) : (
              <>
                <p className="smart-card__intro">Splitst "{activeGroup?.name}" op de bladwijzers in {segments.length} documenten:</p>
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
              Herkent de tabellen in "{activeGroup?.name ?? '—'}" (rijen en kolommen op basis van de tekstposities)
              en zet ze in een Excel-bestand — één werkblad per pagina. Ideaal voor cijferoverzichten en
              jaarrekeningen. Werkt op de tekstlaag; voor scans eerst OCR draaien.
            </p>
            <div className="modal-card__actions">
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy || !activeGroup}
                onClick={() => {
                  setBusy(true)
                  void exportTablesToXlsx()
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
              Haalt alle tekst uit "{activeGroup?.name ?? '—'}" en slaat die op als tekstbestand, als bewerkbaar
              Word-document (.docx, met behoud van lettergroottes en koppen) of als Word-compatibele .rtf.
            </p>
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
