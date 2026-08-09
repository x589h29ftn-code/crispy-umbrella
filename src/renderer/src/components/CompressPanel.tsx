import { useEffect, useRef, useState } from 'react'
import { useStudioStore } from '../store'
import {
  DEFAULT_COMPRESS_OPTIONS,
  buildBaseline,
  compressDocument,
  compressSettings,
  estimateCompression,
  formatSize,
  releaseBaseline,
  saveCompressed,
  type CompressEstimate,
  type CompressOptions
} from '../lib/compress'
import type { SourceFile } from '../types'

interface Baseline {
  bytes: Uint8Array
  source: SourceFile
  sourceId: string
  name: string
}

/**
 * Comprimeren met een schuifregelaar: je ziet meteen wat een instelling
 * oplevert (geschatte grootte én een voorbeeld van een pagina) voordat je het
 * hele document verwerkt.
 */
export default function CompressPanel(): JSX.Element {
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const groups = useStudioStore((s) => s.groups)
  const addToast = useStudioStore((s) => s.addToast)
  const [options, setOptions] = useState<CompressOptions>(DEFAULT_COMPRESS_OPTIONS)
  const [baseline, setBaseline] = useState<Baseline | null>(null)
  const [estimate, setEstimate] = useState<CompressEstimate | null>(null)
  const [estimating, setEstimating] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [failed, setFailed] = useState(false)
  const baselineRef = useRef<Baseline | null>(null)

  const group = groups.find((g) => g.id === activeGroupId) ?? groups[0]

  // Eén volledige export als referentie; die dient ook als bron voor het comprimeren.
  useEffect(() => {
    let cancelled = false
    setBaseline(null)
    setEstimate(null)
    setFailed(false)
    if (!group) return
    void buildBaseline()
      .then((result) => {
        if (cancelled) {
          releaseBaseline(result.sourceId)
          return
        }
        baselineRef.current = result
        setBaseline(result)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      if (baselineRef.current) {
        releaseBaseline(baselineRef.current.sourceId)
        baselineRef.current = null
      }
    }
  }, [group?.id])

  // Schatting + voorbeeld bijwerken zodra de instellingen wijzigen.
  useEffect(() => {
    if (!baseline) return
    let cancelled = false
    setEstimating(true)
    const timer = window.setTimeout(() => {
      void estimateCompression(baseline.source, baseline.bytes.length, options)
        .then((result) => {
          if (!cancelled) setEstimate(result)
        })
        .catch(() => undefined)
        .finally(() => {
          if (!cancelled) setEstimating(false)
        })
    }, 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [baseline, options])

  if (!group) return <div className="smart-card__body">Open eerst een document.</div>
  if (failed) return <div className="smart-card__body">Kon het document niet voorbereiden om te comprimeren.</div>

  const settings = compressSettings(options.quality)
  const originalBytes = baseline?.bytes.length ?? 0
  const saved = estimate && originalBytes ? Math.round((1 - estimate.estimatedBytes / originalBytes) * 100) : null

  async function run(): Promise<void> {
    if (!baseline) return
    setProgress({ done: 0, total: baseline.source.pageCount })
    try {
      const result = await compressDocument(baseline, options, (done, total) => setProgress({ done, total }))
      await saveCompressed(baseline.name, result.bytes, baseline.bytes)
    } catch {
      addToast('error', 'Comprimeren is mislukt')
    } finally {
      setProgress(null)
    }
  }

  return (
    <div className="smart-card__body compress-panel">
      <p className="smart-card__intro">
        Maakt "{group.name}" kleiner om te mailen. Pagina’s worden opnieuw opgebouwd als afbeelding; hoe verder de
        regelaar naar links, hoe kleiner het bestand en hoe grover het beeld.
      </p>

      <div className="compress-panel__slider-row">
        <span className="compress-panel__slider-end">Kleinst</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={options.quality}
          className="compress-panel__slider"
          onChange={(e) => setOptions((o) => ({ ...o, quality: Number(e.target.value) }))}
        />
        <span className="compress-panel__slider-end">Scherpst</span>
      </div>
      <div className="compress-panel__setting">
        <strong>{settings.label}</strong> · {settings.dpi} dpi · kwaliteit {Math.round(settings.jpeg * 100)}%
      </div>

      <div className="compress-panel__layout">
        <div className="compress-panel__options">
          <label className="prefs-check">
            <input
              type="checkbox"
              checked={options.keepTextPages}
              onChange={(e) => setOptions((o) => ({ ...o, keepTextPages: e.target.checked }))}
            />
            <span>
              <span className="prefs-row__title">Tekstpagina’s ongemoeid laten</span>
              <span className="prefs-row__hint">
                Blijven scherp en doorzoekbaar; alleen scans en zware pagina’s worden gecomprimeerd.
              </span>
            </span>
          </label>
          <label className="prefs-check">
            <input
              type="checkbox"
              checked={options.grayscale}
              onChange={(e) => setOptions((o) => ({ ...o, grayscale: e.target.checked }))}
            />
            <span>
              <span className="prefs-row__title">Grijstinten</span>
              <span className="prefs-row__hint">Scheelt fors bij scans van zwarte tekst.</span>
            </span>
          </label>

          <div className="compress-panel__estimate">
            {!baseline && <span className="compress-panel__pending">Document voorbereiden…</span>}
            {baseline && (
              <>
                <div className="compress-panel__row">
                  <span>Nu</span>
                  <strong>{formatSize(originalBytes)}</strong>
                </div>
                <div className="compress-panel__row">
                  <span>Straks (schatting)</span>
                  <strong className={saved !== null && saved > 0 ? 'compress-panel__gain' : undefined}>
                    {estimating || !estimate ? 'berekenen…' : formatSize(estimate.estimatedBytes)}
                    {!estimating && estimate && saved !== null && saved > 0 ? ` (−${saved}%)` : ''}
                  </strong>
                </div>
                {estimate && options.keepTextPages && estimate.keptPages > 0 && (
                  <div className="compress-panel__note">
                    Ongeveer {estimate.keptPages} van de {baseline.source.pageCount} pagina’s houdt zijn tekstlaag.
                  </div>
                )}
                {estimate && saved !== null && saved <= 0 && (
                  <div className="compress-panel__note">
                    Dit document is al compact — comprimeren levert hier weinig op.
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        <div className="compress-panel__preview">
          <div className="compress-panel__preview-head">
            {estimate ? `Voorbeeld — pagina ${estimate.previewPage}` : 'Voorbeeld'}
          </div>
          {estimate?.previewUrl ? (
            <img src={estimate.previewUrl} alt="Voorbeeld van de gecomprimeerde pagina" />
          ) : (
            <div className="compress-panel__preview-empty">{estimating ? 'Bezig…' : '—'}</div>
          )}
        </div>
      </div>

      <div className="modal-card__actions">
        {progress && (
          <span className="compress-panel__progress">
            Pagina {progress.done} van {progress.total}…
          </span>
        )}
        <button
          type="button"
          className="pill-btn pill-btn--primary"
          disabled={!baseline || progress !== null}
          onClick={() => void run()}
        >
          {progress ? 'Bezig…' : 'Comprimeren en opslaan'}
        </button>
      </div>
    </div>
  )
}
