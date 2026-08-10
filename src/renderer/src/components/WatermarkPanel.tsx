import { useState } from 'react'
import { useStudioStore } from '../store'
import {
  DEFAULT_WATERMARK,
  WATERMARK_COLORS,
  WATERMARK_COLOR_LABELS,
  WATERMARK_PRESETS,
  watermarkCss,
  type WatermarkColor
} from '../lib/watermark'
import type { Watermark } from '../types'

/** Breedte van de voorbeeldpagina in px (zie .watermark-panel__layout in styles.css). */
const PREVIEW_WIDTH = 220

/**
 * Watermerk instellen: een vaste tekst kiezen (CONCEPT, NIET VOOR PUBLICATIE,
 * VOOR INTERN GEBRUIK) of zelf een tekst typen. Het watermerk hoort bij het
 * document en komt op elke export, afdruk en mail terecht.
 */
export default function WatermarkPanel(): JSX.Element {
  const groups = useStudioStore((s) => s.groups)
  const activeGroupId = useStudioStore((s) => s.activeGroupId)
  const setGroupWatermark = useStudioStore((s) => s.setGroupWatermark)
  const addToast = useStudioStore((s) => s.addToast)

  const group = groups.find((g) => g.id === activeGroupId) ?? groups[0]
  const [draft, setDraft] = useState<Watermark>(group?.watermark ?? DEFAULT_WATERMARK)
  const [allDocuments, setAllDocuments] = useState(false)

  if (!group) return <div className="smart-card__body">Open eerst een document.</div>

  const preset = (WATERMARK_PRESETS as readonly string[]).includes(draft.text) ? draft.text : null
  const percentage = Math.round(draft.opacity * 100)

  function apply(): void {
    const text = draft.text.trim()
    if (!text) {
      addToast('info', 'Vul eerst een watermerktekst in')
      return
    }
    const watermark: Watermark = { ...draft, text }
    if (allDocuments) {
      for (const g of groups) setGroupWatermark(g.id, watermark)
      addToast('success', `Watermerk "${text}" op alle ${groups.length} documenten gezet`)
    } else {
      setGroupWatermark(group.id, watermark)
      addToast('success', `Watermerk "${text}" op "${group.name}" gezet`)
    }
  }

  function remove(): void {
    if (allDocuments) {
      for (const g of groups) setGroupWatermark(g.id, null)
      addToast('info', 'Watermerk van alle documenten verwijderd')
    } else {
      setGroupWatermark(group.id, null)
      addToast('info', `Watermerk van "${group.name}" verwijderd`)
    }
  }

  return (
    <div className="smart-card__body watermark-panel">
      <p className="smart-card__intro">
        Zet een watermerk over de pagina&apos;s van &quot;{group.name}&quot;. Het watermerk zit niet in de pagina&apos;s
        zelf, maar wordt bij elke export, afdruk en mail meegetekend — je kunt het dus altijd weer weghalen.
      </p>

      <div className="watermark-panel__presets">
        {WATERMARK_PRESETS.map((text) => (
          <button
            key={text}
            type="button"
            className={`watermark-preset${preset === text ? ' watermark-preset--active' : ''}`}
            onClick={() => setDraft((d) => ({ ...d, text }))}
          >
            {text}
          </button>
        ))}
      </div>

      <label className="watermark-panel__field">
        <span className="prefs-row__title">Eigen tekst</span>
        <input
          type="text"
          value={draft.text}
          maxLength={60}
          placeholder="bv. KOPIE — 2025"
          onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
        />
      </label>

      <div className="watermark-panel__layout">
        <div className="watermark-panel__options">
          <label className="watermark-panel__field">
            <span className="prefs-row__title">Doorzichtigheid — {percentage}%</span>
            <input
              type="range"
              min={5}
              max={80}
              step={5}
              value={percentage}
              onChange={(e) => setDraft((d) => ({ ...d, opacity: Number(e.target.value) / 100 }))}
            />
          </label>

          <div className="watermark-panel__row">
            <label className="watermark-panel__field">
              <span className="prefs-row__title">Richting</span>
              <select
                value={draft.style ?? 'diagonal'}
                onChange={(e) => setDraft((d) => ({ ...d, style: e.target.value as Watermark['style'] }))}
              >
                <option value="diagonal">Schuin over de pagina</option>
                <option value="horizontal">Horizontaal</option>
              </select>
            </label>
            <label className="watermark-panel__field">
              <span className="prefs-row__title">Kleur</span>
              <select
                value={draft.color ?? 'grijs'}
                onChange={(e) => setDraft((d) => ({ ...d, color: e.target.value as WatermarkColor }))}
              >
                {(Object.keys(WATERMARK_COLORS) as WatermarkColor[]).map((c) => (
                  <option key={c} value={c}>
                    {WATERMARK_COLOR_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label className="prefs-check">
            <input
              type="checkbox"
              checked={Boolean(draft.firstPageOnly)}
              onChange={(e) => setDraft((d) => ({ ...d, firstPageOnly: e.target.checked }))}
            />
            <span>
              <span className="prefs-row__title">Alleen op de eerste pagina</span>
              <span className="prefs-row__hint">Handig voor een voorblad met &quot;CONCEPT&quot;.</span>
            </span>
          </label>

          {groups.length > 1 && (
            <label className="prefs-check">
              <input type="checkbox" checked={allDocuments} onChange={(e) => setAllDocuments(e.target.checked)} />
              <span>
                <span className="prefs-row__title">Op alle {groups.length} documenten</span>
                <span className="prefs-row__hint">Anders alleen op het actieve document.</span>
              </span>
            </label>
          )}
        </div>

        <div className="watermark-panel__preview">
          <div className="watermark-panel__preview-head">Voorbeeld</div>
          <div className="watermark-panel__sheet">
            <div className="watermark-panel__lines" aria-hidden="true">
              {Array.from({ length: 14 }, (_, i) => (
                <span key={i} style={{ width: `${i % 4 === 3 ? 45 : 80 + (i % 3) * 5}%` }} />
              ))}
            </div>
            {draft.text.trim() && (
              <div
                className="watermark-panel__stamp"
                style={{
                  color: watermarkCss(draft.color),
                  opacity: draft.opacity,
                  // Zelfde maatbepaling als in de PDF: de tekst vult de pagina.
                  fontSize: Math.min(
                    46,
                    (PREVIEW_WIDTH * (draft.style === 'horizontal' ? 0.86 : 1.2)) /
                      Math.max(5, draft.text.trim().length * 0.62)
                  ),
                  transform: `translate(-50%, -50%) rotate(${draft.style === 'horizontal' ? 0 : -45}deg)`
                }}
              >
                {draft.text}
              </div>
            )}
          </div>
          <div className="watermark-panel__preview-note">
            {group.watermark ? `Nu ingesteld: "${group.watermark.text}"` : 'Nu geen watermerk op dit document'}
          </div>
        </div>
      </div>

      <div className="modal-card__actions">
        {(group.watermark || allDocuments) && (
          <button type="button" className="text-btn" onClick={remove}>
            Watermerk verwijderen
          </button>
        )}
        <button type="button" className="pill-btn pill-btn--primary" onClick={apply}>
          Watermerk toepassen
        </button>
      </div>
    </div>
  )
}
