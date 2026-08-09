import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'
import {
  DEFAULT_MARKDOWN_OPTIONS,
  buildMarkdown,
  saveMarkdown,
  type MarkdownOptions,
  type MarkdownStats
} from '../lib/markdownExport'
import type { DocGroup } from '../types'

const OPTIONS_KEY = 'pdf-studio-markdown-options'

function loadOptions(): MarkdownOptions {
  try {
    const raw = window.localStorage.getItem(OPTIONS_KEY)
    if (raw) return { ...DEFAULT_MARKDOWN_OPTIONS, ...JSON.parse(raw) }
  } catch {
    // Kapotte voorkeur: standaardwaarden.
  }
  return DEFAULT_MARKDOWN_OPTIONS
}

interface Props {
  group: DocGroup | undefined
}

/**
 * Markdown-export met een voorbeeld dat meteen meebeweegt met de instellingen,
 * zodat je vóór het opslaan ziet wat de app van je PDF maakt.
 */
export default function MarkdownPanel({ group }: Props): JSX.Element {
  const sources = useStudioStore((s) => s.sources)
  const addToast = useStudioStore((s) => s.addToast)
  const [options, setOptions] = useState<MarkdownOptions>(loadOptions)
  const [markdown, setMarkdown] = useState('')
  const [stats, setStats] = useState<MarkdownStats | null>(null)
  const [busy, setBusy] = useState(false)

  function update(patch: Partial<MarkdownOptions>): void {
    setOptions((prev) => {
      const next = { ...prev, ...patch }
      window.localStorage.setItem(OPTIONS_KEY, JSON.stringify(next))
      return next
    })
  }

  // Voorbeeld opnieuw opbouwen bij elke wijziging (kort uitgesteld, zodat
  // klikken op de schakelaars soepel blijft bij grote documenten).
  useEffect(() => {
    if (!group) return
    let cancelled = false
    setBusy(true)
    const timer = window.setTimeout(() => {
      void buildMarkdown(group, sources, options)
        .then(({ markdown, stats }) => {
          if (cancelled) return
          setMarkdown(markdown)
          setStats(stats)
        })
        .catch(() => {
          if (!cancelled) addToast('error', 'Kon de Markdown niet opbouwen')
        })
        .finally(() => {
          if (!cancelled) setBusy(false)
        })
    }, 150)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [group, sources, options, addToast])

  if (!group) return <div className="smart-card__body">Open eerst een document.</div>

  const empty = !busy && !markdown.trim()

  return (
    <div className="smart-card__body markdown-panel">
      <p className="smart-card__intro">
        Zet "{group.name}" om naar Markdown (.md): koppen, opsommingen en tabellen worden herkend uit de opmaak van
        de PDF. Handig voor Obsidian, Notion, een wiki of gewoon als leesbare tekst.
      </p>

      <div className="markdown-panel__layout">
        <div className="markdown-panel__options">
          {(
            [
              ['headings', 'Koppen herkennen', 'Grote en vette regels, en de bladwijzers van de PDF.'],
              ['lists', 'Opsommingen', '•, -, 1. worden Markdown-lijsten (met inspringing).'],
              ['tables', 'Tabellen', 'Uitgelijnde kolommen worden een Markdown-tabel.'],
              ['joinParagraphs', 'Alinea’s samenvoegen', 'Regels van dezelfde alinea aan elkaar, inclusief afbreekstreepjes.'],
              ['dropRunningHeads', 'Kop-/voetteksten weglaten', 'Regels die op vrijwel elke pagina terugkomen.'],
              ['titleHeading', 'Documentnaam als titel', 'Begint het bestand met "# Documentnaam".'],
              ['frontMatter', 'YAML-kop', 'Titel, aantal pagina’s en datum bovenaan (Obsidian).']
            ] as [keyof MarkdownOptions, string, string][]
          ).map(([key, label, hint]) => (
            <label key={key} className="prefs-check markdown-panel__check">
              <input
                type="checkbox"
                checked={Boolean(options[key])}
                onChange={(e) => update({ [key]: e.target.checked } as Partial<MarkdownOptions>)}
              />
              <span>
                <span className="prefs-row__title">{label}</span>
                <span className="prefs-row__hint">{hint}</span>
              </span>
            </label>
          ))}

          <div className="markdown-panel__segment">
            <span className="prefs-row__title">Tussen pagina’s</span>
            <div className="prefs-segmented">
              {(
                [
                  ['none', 'Niets'],
                  ['comment', 'Notitie'],
                  ['rule', 'Streep']
                ] as [MarkdownOptions['pageBreaks'], string][]
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  className={`pill-btn${options.pageBreaks === value ? ' pill-btn--primary' : ''}`}
                  onClick={() => update({ pageBreaks: value })}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="markdown-panel__preview">
          <div className="markdown-panel__preview-head">
            <span>Voorbeeld</span>
            {stats && !busy && (
              <span className="markdown-panel__stats">
                {stats.headings} koppen · {stats.tables} tabellen · {stats.listItems} lijstregels · {stats.words} woorden
              </span>
            )}
            {busy && <span className="markdown-panel__stats">Bezig…</span>}
          </div>
          <pre className="markdown-panel__code">{empty ? '' : markdown}</pre>
          {empty && (
            <div className="markdown-panel__empty">
              Geen tekstlaag gevonden — dit is waarschijnlijk een scan. Voer eerst OCR uit (Slim → Opschonen).
            </div>
          )}
          {stats && stats.pagesWithoutText > 0 && !empty && (
            <div className="markdown-panel__warning">
              {stats.pagesWithoutText} van de {stats.pages} pagina’s heeft geen tekstlaag (scan) — daar staat een
              notitie in plaats van tekst.
            </div>
          )}
        </div>
      </div>

      <div className="modal-card__actions">
        <button
          type="button"
          className="pill-btn"
          disabled={!markdown.trim()}
          onClick={() => {
            void navigator.clipboard
              .writeText(markdown)
              .then(() => addToast('success', 'Markdown gekopieerd naar het klembord'))
              .catch(() => addToast('error', 'Kopiëren naar het klembord is mislukt'))
          }}
        >
          Kopiëren
        </button>
        <button
          type="button"
          className="pill-btn pill-btn--primary"
          disabled={!markdown.trim()}
          onClick={() => void saveMarkdown(markdown, group.name)}
        >
          Opslaan als .md
        </button>
      </div>
    </div>
  )
}
