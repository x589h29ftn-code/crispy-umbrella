import { useEffect, useState } from 'react'
import { nanoid } from 'nanoid'
import { useStudioStore } from '../store'
import { extractFields, getGroupText, suggestName, DOC_TYPE_LABELS } from '../lib/docAnalysis'
import { cleanupScannedPage, isBlankPage } from '../lib/scanTools'
import { exportDataToCsv } from '../lib/dataExport'
import { exportTablesToXlsx } from '../lib/tableExport'
import { exportGroupText } from '../lib/textExport'
import { getGroupBookmarks } from '../lib/bookmarks'
import { getTextLineBoxes } from '../lib/textLines'
import { IconClose, IconFile, IconTrash } from './icons'
import ScanNotice from './ScanNotice'
import type { DocGroup } from '../types'

type Tab = 'rename' | 'blank' | 'cleanup' | 'data' | 'split' | 'sort' | 'text' | 'table' | 'compress' | 'portfolio'

/**
 * "Slimme documenten": automatisch hernoemen op inhoud, lege pagina's vinden en
 * verwijderen, gescande pagina's opschonen, en de kerngegevens naar CSV.
 */
export default function SmartDialog(): JSX.Element | null {
  const open = useStudioStore((s) => s.smartDialogOpen)
  const setOpen = useStudioStore((s) => s.setSmartDialogOpen)
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

  const TABS: [Tab, string][] = [
    ['rename', 'Hernoemen'],
    ['split', 'Splitsen'],
    ['sort', 'Sorteren'],
    ['blank', "Lege pagina's"],
    ['cleanup', 'Opschonen'],
    ['data', 'Gegevens → CSV'],
    ['table', 'Tabel → Excel'],
    ['text', 'Tekst / Word'],
    ['compress', 'Comprimeren'],
    ['portfolio', 'Dossier']
  ]

  return (
    <div className="modal-overlay" onClick={() => setOpen(false)}>
      <div className="modal-card smart-card" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn icon-btn--chrome smart-card__close" title="Sluiten" onClick={() => setOpen(false)}>
          <IconClose size={13} />
        </button>
        <h3>Slimme documenten</h3>
        <div className="smart-card__tabs">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`smart-card__tab${tab === key ? ' smart-card__tab--active' : ''}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>

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

        {tab === 'compress' && (
          <div className="smart-card__body">
            <p className="smart-card__intro">
              Maakt "{activeGroup?.name ?? '—'}" kleiner om te mailen: elke pagina wordt als compacte afbeelding
              opgeslagen. Vooral effectief bij scans; de tekstlaag vervalt (draai daarna zo nodig OCR). Is het
              resultaat niet kleiner, dan wordt de gewone export bewaard.
            </p>
            <div className="modal-card__actions">
              <button
                type="button"
                className="pill-btn"
                disabled={busy || !activeGroup}
                onClick={() => {
                  setBusy(true)
                  void import('../lib/compress')
                    .then((m) => m.compressActiveGroup('normal'))
                    .finally(() => {
                      setBusy(false)
                      setOpen(false)
                    })
                }}
              >
                Normaal (150 dpi)
              </button>
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                disabled={busy || !activeGroup}
                onClick={() => {
                  setBusy(true)
                  void import('../lib/compress')
                    .then((m) => m.compressActiveGroup('strong'))
                    .finally(() => {
                      setBusy(false)
                      setOpen(false)
                    })
                }}
              >
                {busy ? 'Bezig…' : 'Sterk (100 dpi)'}
              </button>
            </div>
          </div>
        )}

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
              Haalt alle tekst uit "{activeGroup?.name ?? '—'}" en slaat die op als tekstbestand of als
              Word-compatibel bestand (.rtf).
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
                  void exportGroupText('rtf')
                }}
              >
                Voor Word (.rtf)
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
