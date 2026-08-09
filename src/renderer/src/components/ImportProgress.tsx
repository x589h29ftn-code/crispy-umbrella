import { useStudioStore } from '../store'

/**
 * Voortgang tijdens het openen van bestanden. Bij één bestand blijft het bij
 * "Bezig met openen…"; bij een stapel zie je hoeveel er al klaar zijn.
 */
export default function ImportProgress(): JSX.Element | null {
  const progress = useStudioStore((s) => s.importProgress)
  if (!progress) return null

  const { done, total } = progress
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div className="import-progress" role="status" aria-live="polite">
      <span className="import-progress__label">
        {total > 1 ? `Bestanden openen… ${done} van ${total}` : 'Bezig met openen…'}
      </span>
      <span className="import-progress__track">
        <span
          className={`import-progress__bar${total > 1 ? '' : ' import-progress__bar--indeterminate'}`}
          style={total > 1 ? { width: `${pct}%` } : undefined}
        />
      </span>
    </div>
  )
}
