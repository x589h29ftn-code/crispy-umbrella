import { useEffect, useRef, useState } from 'react'
import { useStudioStore } from '../store'
import { searchProject, type SearchOutcome } from '../lib/textIndex'
import { ocrAvailable, ocrPage } from '../lib/ocr'
import { IconClose, IconSearch } from './icons'

interface OcrProgress {
  done: number
  total: number
}

export default function SearchPanel(): JSX.Element | null {
  const open = useStudioStore((s) => s.searchOpen)
  const setOpen = useStudioStore((s) => s.setSearchOpen)
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const openLightbox = useStudioStore((s) => s.openLightbox)
  const setSearchHighlight = useStudioStore((s) => s.setSearchHighlight)
  const addToast = useStudioStore((s) => s.addToast)

  const activeEditorTab = useStudioStore((s) => s.activeEditorTab)

  const [query, setQuery] = useState('')
  const [outcome, setOutcome] = useState<SearchOutcome | null>(null)
  const [searching, setSearching] = useState(false)
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
  const [hitIndex, setHitIndex] = useState(-1)
  const [replaceOpen, setReplaceOpen] = useState(false)
  const [replaceText, setReplaceText] = useState('')
  const [replacing, setReplacing] = useState(false)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const runIdRef = useRef(0)

  async function doReplaceAll(): Promise<void> {
    const needle = query.trim()
    if (!needle || replacing) return
    const state = useStudioStore.getState()
    const group = state.groups.find((g) => g.id === activeGroupId) ?? state.groups[0]
    if (!group) return
    setReplacing(true)
    try {
      const { planFindReplace } = await import('../lib/findReplace')
      const plan = await planFindReplace(group, state.sources, needle, replaceText)
      const total = plan.bodyMatches + plan.annotationMatches
      if (!total) {
        addToast('info', `Geen treffers voor "${needle}" in dit document`)
        return
      }
      plan.apply()
      addToast('success', `${total} keer vervangen in "${group.name}"`)
    } catch {
      addToast('error', 'Vervangen is mislukt')
    } finally {
      setReplacing(false)
    }
  }

  function close(): void {
    setOpen(false)
    // Bij het sluiten verdwijnen alle gele zoekmarkeringen weer.
    setSearchHighlight(null)
  }

  /** Naar een treffer: in het open leestabblad scrollt de pagina in beeld;
   * anders opent het volledig scherm op die pagina. */
  function goToHit(index: number): void {
    const hit = (outcome?.hits ?? [])[index]
    if (!hit) return
    setHitIndex(index)
    setSearchHighlight({ pageId: hit.pageId, query: query.trim() })
    const state = useStudioStore.getState()
    const group = state.groups.find((g) => g.pages.some((p) => p.id === hit.pageId))
    if (!group || group.id !== activeEditorTab) openLightbox(hit.pageId)
  }

  // Debounced search over all documents; also runs with an empty query so the
  // panel can report scanned pages without a text layer right away.
  useEffect(() => {
    if (!open) return
    const runId = (runIdRef.current += 1)
    setSearching(true)
    const timer = window.setTimeout(() => {
      searchProject(groups, sources, query)
        .then((result) => {
          if (runIdRef.current === runId) {
            setOutcome(result)
            setSearching(false)
          }
        })
        .catch(() => {
          if (runIdRef.current === runId) setSearching(false)
        })
    }, 250)
    return () => window.clearTimeout(timer)
  }, [open, query, groups, sources])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setOutcome(null)
      setOcrProgress(null)
      setHitIndex(-1)
      setSearchHighlight(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    setHitIndex(-1)
  }, [query])

  if (!open) return null

  async function runOcr(): Promise<void> {
    if (!outcome || ocrProgress) return
    const scans = outcome.scansWithoutText
    setOcrProgress({ done: 0, total: scans.length })
    let failed = 0
    for (let i = 0; i < scans.length; i += 1) {
      const scan = scans[i]
      const source = sources.get(scan.sourceId)
      if (source) {
        try {
          await ocrPage(source, scan.sourcePageIndex, scan.rotation)
        } catch {
          failed += 1
        }
      }
      setOcrProgress({ done: i + 1, total: scans.length })
    }
    setOcrProgress(null)
    if (failed) addToast('error', `Tekstherkenning mislukt op ${failed} pagina('s)`)
    else addToast('success', `Tekst herkend op ${scans.length} pagina('s) — ook doorzoekbaar in de export`)
    // Re-run the search with the fresh OCR results.
    const result = await searchProject(groups, sources, query)
    setOutcome(result)
  }

  function renderSnippet(snippet: string): JSX.Element {
    const needle = query.trim()
    if (!needle) return <>{snippet}</>
    const lower = snippet.toLowerCase()
    const idx = lower.indexOf(needle.toLowerCase())
    if (idx === -1) return <>{snippet}</>
    return (
      <>
        {snippet.slice(0, idx)}
        <mark>{snippet.slice(idx, idx + needle.length)}</mark>
        {snippet.slice(idx + needle.length)}
      </>
    )
  }

  const scans = outcome?.scansWithoutText ?? []
  const hits = outcome?.hits ?? []

  return (
    <div className="search-panel" onClick={(e) => e.stopPropagation()}>
      <div className="search-panel__bar">
        <IconSearch size={15} className="search-panel__icon" />
        <input
          autoFocus
          type="text"
          placeholder="Zoek in alle documenten…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') close()
            if (e.key === 'Enter') goToHit(e.shiftKey ? Math.max(0, hitIndex - 1) : hitIndex + 1)
          }}
        />
        {hits.length > 0 && (
          <div className="search-panel__nav" title="Blader door de treffers (Enter / Shift+Enter)">
            <button type="button" className="icon-btn icon-btn--chrome" onClick={() => goToHit(Math.max(0, hitIndex - 1))}>
              ‹
            </button>
            <span>
              {Math.max(1, hitIndex + 1)}/{hits.length}
            </span>
            <button
              type="button"
              className="icon-btn icon-btn--chrome"
              onClick={() => goToHit(Math.min(hits.length - 1, hitIndex + 1))}
            >
              ›
            </button>
          </div>
        )}
        <button
          type="button"
          className={`icon-btn icon-btn--chrome${replaceOpen ? ' icon-btn--active' : ''}`}
          title="Zoeken & vervangen"
          onClick={() => setReplaceOpen((v) => !v)}
        >
          ⇄
        </button>
        <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten (Esc)" onClick={close}>
          <IconClose size={13} />
        </button>
      </div>

      {replaceOpen && (
        <div className="search-panel__replace">
          <input
            type="text"
            placeholder="Vervangen door… (leeg = verwijderen)"
            value={replaceText}
            onChange={(e) => setReplaceText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void doReplaceAll()
              if (e.key === 'Escape') close()
            }}
          />
          <button type="button" className="pill-btn pill-btn--primary" disabled={!query.trim() || replacing} onClick={() => void doReplaceAll()}>
            {replacing ? 'Bezig…' : 'Alles vervangen'}
          </button>
        </div>
      )}

      {query.trim() && (
        <div className="search-panel__results">
          {searching && <div className="search-panel__status">Zoeken…</div>}
          {!searching && hits.length === 0 && <div className="search-panel__status">Geen resultaten</div>}
          {hits.slice(0, 50).map((hit, index) => (
            <button
              key={hit.pageId}
              type="button"
              className={`search-panel__hit${index === hitIndex ? ' search-panel__hit--active' : ''}`}
              onClick={() => goToHit(index)}
            >
              <span className="search-panel__hit-where">
                {hit.groupName} · pagina {hit.pageNumber}
                {hit.count > 1 ? ` · ${hit.count}×` : ''}
                {hit.viaOcr ? ' · OCR' : ''}
              </span>
              <span className="search-panel__hit-snippet">{renderSnippet(hit.snippet)}</span>
            </button>
          ))}
          {hits.length > 50 && <div className="search-panel__status">Eerste 50 resultaten getoond</div>}
        </div>
      )}

      {scans.length > 0 && (
        <div className="search-panel__ocr">
          {ocrProgress ? (
            <span className="search-panel__status">
              Tekst herkennen… pagina {ocrProgress.done} van {ocrProgress.total}
            </span>
          ) : ocrAvailable() ? (
            <>
              <span className="search-panel__status">
                {scans.length === 1
                  ? '1 gescande pagina zonder tekstlaag'
                  : `${scans.length} gescande pagina's zonder tekstlaag`}
              </span>
              <button type="button" className="pill-btn pill-btn--primary" onClick={() => void runOcr()}>
                Tekst herkennen (OCR)
              </button>
            </>
          ) : (
            <span className="search-panel__status">
              {scans.length} gescande pagina('s) zonder tekstlaag — OCR is alleen in de desktop-app beschikbaar
            </span>
          )}
        </div>
      )}
    </div>
  )
}
