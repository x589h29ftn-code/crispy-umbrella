import { getTextLineBoxes } from './textLines'
import { useStudioStore } from '../store'
import type { DocGroup, SourceFile } from '../types'

async function groupToText(group: DocGroup, sources: Map<string, SourceFile>): Promise<string[]> {
  const lines: string[] = []
  for (let p = 0; p < group.pages.length; p += 1) {
    const page = group.pages[p]
    const source = sources.get(page.sourceId)
    if (!source) continue
    if (p > 0) lines.push('')
    const boxes = await getTextLineBoxes(source, page.sourcePageIndex, page.rotation).catch(() => [])
    for (const b of boxes) if (b.str.trim()) lines.push(b.str)
  }
  return lines
}

/** RTF-escape: backslashes/accolades ontsnappen, niet-ASCII als \uN?. */
function rtfEscape(text: string): string {
  let out = ''
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    if (ch === '\\' || ch === '{' || ch === '}') out += `\\${ch}`
    else if (code > 127) out += `\\u${code > 32767 ? code - 65536 : code}?`
    else out += ch
  }
  return out
}

/** Exporteert de tekst van het actieve document als .txt of Word-compatibele .rtf. */
export async function exportGroupText(format: 'txt' | 'rtf'): Promise<void> {
  const state = useStudioStore.getState()
  const group = state.groups.find((g) => g.id === state.activeGroupId) ?? state.groups[0]
  if (!group) {
    state.addToast('info', 'Er is geen document om te exporteren')
    return
  }
  try {
    const lines = await groupToText(group, state.sources)
    if (!lines.some((l) => l.trim())) {
      state.addToast('info', 'Geen tekstlaag gevonden — voer eerst OCR uit voor gescande documenten')
      return
    }
    const base = group.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'document'
    if (format === 'txt') {
      const bytes = new TextEncoder().encode('﻿' + lines.join('\r\n'))
      const result = await window.api.saveFile(`${base}.txt`, bytes, 'txt')
      if (result.saved) state.addToast('success', `Tekst opgeslagen als "${base}.txt"`)
    } else {
      const body = lines.map((l) => (l ? rtfEscape(l) : '')).join('\\par\r\n')
      const rtf = `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22 ${body}\\par}`
      const bytes = new TextEncoder().encode(rtf)
      const result = await window.api.saveFile(`${base}.rtf`, bytes, 'rtf')
      if (result.saved) state.addToast('success', `Word-document opgeslagen als "${base}.rtf"`)
    }
  } catch {
    state.addToast('error', 'Exporteren van de tekst is mislukt')
  }
}
