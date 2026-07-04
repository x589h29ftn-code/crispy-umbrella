import { useEffect, useState } from 'react'
import { getPlacementVisualBox, type SignatureVisualBox } from '../lib/pdfEngine'
import { getFormFields, type FormFieldInfo } from '../lib/forms'
import { useStudioStore } from '../store'
import { IconCheck } from './icons'
import type { SourceFile } from '../types'

interface Entry {
  field: FormFieldInfo
  box: SignatureVisualBox
  key: string
}

interface Props {
  source: SourceFile
  pageIndex: number
  rotation: 0 | 90 | 180 | 270
  /** Visual page units → CSS pixels. */
  scale: number
  /** Whether the layer accepts input (form mode active). */
  active: boolean
  /** Called once the fields are known, with the number of fields on this page. */
  onFieldCount?: (count: number) => void
}

/**
 * Interactive overlay for AcroForm fields on one page: text inputs, checkboxes,
 * dropdowns and radio buttons at the exact widget positions. Values live in the
 * store (per source document) and are written into the PDF on export.
 */
export default function FormLayer({ source, pageIndex, rotation, scale, active, onFieldCount }: Props): JSX.Element | null {
  const formValues = useStudioStore((s) => s.formValues[source.id])
  const setFormValue = useStudioStore((s) => s.setFormValue)
  const [entries, setEntries] = useState<Entry[]>([])

  useEffect(() => {
    let cancelled = false
    getFormFields(source)
      .then(async (fields) => {
        const onPage = fields.filter((f) => f.pageIndex === pageIndex)
        const resolved = await Promise.all(
          onPage.map(async (field, i) => ({
            field,
            key: `${field.name}:${i}`,
            box: await getPlacementVisualBox(source, pageIndex, rotation, {
              x: field.rect.x,
              y: field.rect.y,
              width: field.rect.width,
              height: field.rect.height
            })
          }))
        )
        if (!cancelled) {
          setEntries(resolved)
          onFieldCount?.(onPage.length)
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, pageIndex, rotation])

  if (!active || !entries.length) return null

  function valueOf(field: FormFieldInfo): string | boolean {
    const stored = formValues?.[field.name]
    return stored !== undefined ? stored : field.defaultValue
  }

  return (
    <div className="form-layer" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
      {entries.map(({ field, box, key }) => {
        const style: React.CSSProperties = {
          left: box.pivotX * scale,
          top: (box.pivotY - box.height) * scale,
          width: box.width * scale,
          height: box.height * scale,
          transform: `rotate(${box.rotateDeg}deg)`
        }
        if (field.kind === 'checkbox') {
          const checked = Boolean(valueOf(field))
          return (
            <button
              key={key}
              type="button"
              className={`form-layer__check${checked ? ' form-layer__check--on' : ''}`}
              style={style}
              title={field.name}
              onClick={() => setFormValue(source.id, field.name, !checked)}
            >
              {checked && <IconCheck size={Math.max(9, box.height * scale * 0.7)} />}
            </button>
          )
        }
        if (field.kind === 'radio') {
          const selected = valueOf(field) === field.radioOption && field.radioOption !== null
          return (
            <button
              key={key}
              type="button"
              className={`form-layer__radio${selected ? ' form-layer__radio--on' : ''}`}
              style={style}
              title={`${field.name}: ${field.radioOption ?? ''}`}
              onClick={() => field.radioOption && setFormValue(source.id, field.name, field.radioOption)}
            />
          )
        }
        if (field.kind === 'dropdown') {
          return (
            <select
              key={key}
              className="form-layer__field form-layer__select"
              style={{ ...style, fontSize: Math.max(9, box.height * scale * 0.55) }}
              title={field.name}
              value={String(valueOf(field))}
              onChange={(e) => setFormValue(source.id, field.name, e.target.value)}
            >
              <option value="" />
              {field.options.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          )
        }
        return field.multiline ? (
          <textarea
            key={key}
            className="form-layer__field form-layer__textarea"
            style={{ ...style, fontSize: Math.max(9, Math.min(16, box.height * scale * 0.22)) }}
            title={field.name}
            value={String(valueOf(field))}
            onChange={(e) => setFormValue(source.id, field.name, e.target.value)}
          />
        ) : (
          <input
            key={key}
            type="text"
            className="form-layer__field"
            style={{ ...style, fontSize: Math.max(9, box.height * scale * 0.55) }}
            title={field.name}
            value={String(valueOf(field))}
            onChange={(e) => setFormValue(source.id, field.name, e.target.value)}
          />
        )
      })}
    </div>
  )
}
