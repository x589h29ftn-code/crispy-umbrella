import {
  PDFCheckBox,
  PDFDict,
  PDFDocument,
  PDFDropdown,
  PDFName,
  PDFRadioGroup,
  PDFTextField
} from '@cantoo/pdf-lib'
import { getPdfLibDocument } from './pdfEngine'
import type { SourceFile } from '../types'

export type FormFieldKind = 'text' | 'checkbox' | 'dropdown' | 'radio'

export interface FormFieldInfo {
  /** Field name (radio widgets of one group share it). */
  name: string
  kind: FormFieldKind
  pageIndex: number
  /** Widget box in content space (unrotated media box, bottom-left origin). */
  rect: { x: number; y: number; width: number; height: number }
  /** Dropdown options, or for a radio widget the option this widget selects. */
  options: string[]
  radioOption: string | null
  multiline: boolean
  /** Current value in the source document. */
  defaultValue: string | boolean
}

export type FormValues = Record<string, string | boolean>

const fieldsCache = new Map<string, Promise<FormFieldInfo[]>>()

export function forgetFormFields(sourceId: string): void {
  fieldsCache.delete(sourceId)
}

/** All fillable AcroForm fields of a source PDF, one entry per widget. */
export function getFormFields(source: SourceFile): Promise<FormFieldInfo[]> {
  let cached = fieldsCache.get(source.id)
  if (!cached) {
    cached = readFormFields(source).catch(() => [])
    fieldsCache.set(source.id, cached)
  }
  return cached
}

/** The non-Off appearance-state name of a radio/checkbox widget (its "on" value). */
function widgetOnValue(widgetDict: PDFDict): string | null {
  const ap = widgetDict.get(PDFName.of('AP'))
  const apDict = ap instanceof PDFDict ? ap : null
  const normal = apDict?.get(PDFName.of('N'))
  if (!(normal instanceof PDFDict)) return null
  for (const [key] of normal.entries()) {
    const name = key.decodeText()
    if (name !== 'Off') return name
  }
  return null
}

/**
 * A radio widget's appearance key can be the option name itself or an index
 * into the group's /Opt list (pdf-lib writes /0, /1, …). Map it to the option
 * name that PDFRadioGroup.select() accepts.
 */
function mapRadioOption(options: string[], apKey: string | null): string | null {
  if (apKey === null) return null
  if (/^\d+$/.test(apKey)) {
    const byIndex = options[Number(apKey)]
    if (byIndex !== undefined && !options.includes(apKey)) return byIndex
  }
  return apKey
}

async function readFormFields(source: SourceFile): Promise<FormFieldInfo[]> {
  const doc = await getPdfLibDocument(source)
  const form = doc.getForm()
  const pages = doc.getPages()
  const result: FormFieldInfo[] = []

  const pageIndexByRef = new Map<string, number>()
  pages.forEach((page, i) => pageIndexByRef.set(page.ref.toString(), i))

  function findPageIndex(widgetDict: PDFDict): number {
    const p = widgetDict.get(PDFName.of('P'))
    if (p && pageIndexByRef.has(String(p))) return pageIndexByRef.get(String(p))!
    for (let i = 0; i < pages.length; i += 1) {
      const annots = pages[i].node.Annots()
      if (!annots) continue
      for (let j = 0; j < annots.size(); j += 1) {
        if (doc.context.lookup(annots.get(j)) === widgetDict) return i
      }
    }
    return -1
  }

  for (const field of form.getFields()) {
    let kind: FormFieldKind | null = null
    let options: string[] = []
    let multiline = false
    let defaultValue: string | boolean = ''
    if (field instanceof PDFTextField) {
      kind = 'text'
      multiline = field.isMultiline()
      defaultValue = field.getText() ?? ''
    } else if (field instanceof PDFCheckBox) {
      kind = 'checkbox'
      defaultValue = field.isChecked()
    } else if (field instanceof PDFDropdown) {
      kind = 'dropdown'
      options = field.getOptions()
      defaultValue = field.getSelected()[0] ?? ''
    } else if (field instanceof PDFRadioGroup) {
      kind = 'radio'
      options = field.getOptions()
      defaultValue = field.getSelected() ?? ''
    }
    if (!kind) continue

    for (const widget of field.acroField.getWidgets()) {
      const pageIndex = findPageIndex(widget.dict)
      if (pageIndex === -1) continue
      const rect = widget.getRectangle()
      result.push({
        name: field.getName(),
        kind,
        pageIndex,
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        options,
        radioOption: kind === 'radio' ? mapRadioOption(options, widgetOnValue(widget.dict)) : null,
        multiline,
        defaultValue
      })
    }
  }
  return result
}

/**
 * Fills the given values into a document's form. Unknown fields and value
 * mismatches are skipped so a stale value can never break the export.
 */
export function applyFormValues(doc: PDFDocument, values: FormValues): void {
  let form
  try {
    form = doc.getForm()
  } catch {
    return
  }
  for (const [name, value] of Object.entries(values)) {
    try {
      const field = form.getFields().find((f) => f.getName() === name)
      if (!field) continue
      if (field instanceof PDFTextField) {
        field.setText(String(value ?? ''))
      } else if (field instanceof PDFCheckBox) {
        if (value) field.check()
        else field.uncheck()
      } else if (field instanceof PDFDropdown) {
        if (typeof value === 'string' && value) field.select(value)
      } else if (field instanceof PDFRadioGroup) {
        if (typeof value === 'string' && value) field.select(value)
      }
    } catch {
      // Skip fields that refuse the value (readonly, invalid option, …).
    }
  }
  try {
    form.updateFieldAppearances()
  } catch {
    // Appearance regeneration is best-effort; NeedAppearances covers the rest.
  }
}
