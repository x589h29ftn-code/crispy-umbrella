import { useStudioStore } from '../store'
import { NUMBER_FORMAT_EXAMPLES, NUMBER_FORMAT_LABELS, type NumberFormatChoice } from '../lib/numberFormat'

const CHOICES: NumberFormatChoice[] = ['auto', 'none', 'two']

/**
 * Keuze voor de getalopmaak bij export naar Word en Excel. De keuze geldt voor
 * beide en wordt onthouden.
 */
export default function NumberFormatPicker(): JSX.Element {
  const numberFormat = useStudioStore((s) => s.numberFormat)
  const setNumberFormat = useStudioStore((s) => s.setNumberFormat)

  return (
    <div className="number-format">
      <div className="number-format__head">
        <span className="prefs-row__title">Getallen en bedragen</span>
        <span className="prefs-row__hint">{NUMBER_FORMAT_EXAMPLES[numberFormat]}</span>
      </div>
      <div className="prefs-segmented">
        {CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            className={`pill-btn${numberFormat === choice ? ' pill-btn--primary' : ''}`}
            title={NUMBER_FORMAT_EXAMPLES[choice]}
            onClick={() => setNumberFormat(choice)}
          >
            {NUMBER_FORMAT_LABELS[choice]}
          </button>
        ))}
      </div>
    </div>
  )
}
