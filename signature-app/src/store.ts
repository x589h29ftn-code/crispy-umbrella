import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { GeneratedSignature, Phase, WizardAnswers } from './types'
import { getStyle } from './data/collections'
import { hashString } from './engine/random'

export const MAX_STYLES = 9
export const MAX_COLLECTIONS = 3

interface AppState {
  phase: Phase
  answers: Partial<WizardAnswers>
  currentStep: number
  selected: GeneratedSignature[]
  /** Variatieteller per stijl: bepaalt de seed van de preview op de stijlkaart. */
  styleVariants: Record<string, number>
  notice: string | null

  setPhase: (phase: Phase) => void
  answerQuestion: <K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => void
  setStep: (step: number) => void
  toggleStyle: (styleId: string, text: string, variant: number) => void
  shuffleStyle: (styleId: string) => void
  updateSignature: (id: string, patch: Partial<GeneratedSignature>) => void
  removeSignature: (id: string) => void
  clearNotice: () => void
  reset: () => void
}

/** Seed-basis voor een stijl + naamvariant + variatienummer; variant 0 blijft
 *  gelijk aan de oorspronkelijke opbouw zodat bestaande selecties intact zijn. */
export function signatureId(styleId: string, text: string, variant: number): string {
  return variant > 0 ? `${styleId}::${text}::v${variant}` : `${styleId}::${text}`
}

function selectedCollections(selected: GeneratedSignature[]): Set<string> {
  const set = new Set<string>()
  for (const sig of selected) {
    const style = getStyle(sig.styleId)
    if (style) set.add(style.collectionId)
  }
  return set
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      phase: 'landing',
      answers: {},
      currentStep: 0,
      selected: [],
      styleVariants: {},
      notice: null,

      setPhase: (phase) => set({ phase }),

      answerQuestion: (key, value) =>
        set((s) => ({ answers: { ...s.answers, [key]: value } })),

      setStep: (currentStep) => set({ currentStep }),

      toggleStyle: (styleId, text, variant) => {
        const { selected } = get()
        const id = signatureId(styleId, text, variant)
        if (selected.some((sig) => sig.id === id)) {
          set({ selected: selected.filter((sig) => sig.id !== id), notice: null })
          return
        }
        if (selected.length >= MAX_STYLES) {
          set({ notice: `Je kunt maximaal ${MAX_STYLES} handtekeningen kiezen.` })
          return
        }
        const style = getStyle(styleId)
        if (!style) return
        const collections = selectedCollections(selected)
        if (!collections.has(style.collectionId) && collections.size >= MAX_COLLECTIONS) {
          set({ notice: `Je kunt uit maximaal ${MAX_COLLECTIONS} collecties kiezen.` })
          return
        }
        set({
          selected: [...selected, { id, styleId, text, seed: hashString(id) }],
          notice: null
        })
      },

      shuffleStyle: (styleId) =>
        set((s) => ({
          styleVariants: { ...s.styleVariants, [styleId]: (s.styleVariants[styleId] ?? 0) + 1 }
        })),

      updateSignature: (id, patch) =>
        set((s) => ({
          selected: s.selected.map((sig) => (sig.id === id ? { ...sig, ...patch } : sig))
        })),

      removeSignature: (id) =>
        set((s) => ({ selected: s.selected.filter((sig) => sig.id !== id) })),

      clearNotice: () => set({ notice: null }),

      reset: () =>
        set({ phase: 'landing', answers: {}, currentStep: 0, selected: [], styleVariants: {}, notice: null })
    }),
    {
      name: 'handtekening-studio',
      partialize: (s) => ({
        phase: s.phase,
        answers: s.answers,
        currentStep: s.currentStep,
        selected: s.selected,
        styleVariants: s.styleVariants
      })
    }
  )
)

export function countSelectedInCollection(selected: GeneratedSignature[], collectionId: string): number {
  return selected.filter((sig) => getStyle(sig.styleId)?.collectionId === collectionId).length
}

export function usedCollectionCount(selected: GeneratedSignature[]): number {
  return selectedCollections(selected).size
}
