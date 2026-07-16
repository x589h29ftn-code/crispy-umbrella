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
  notice: string | null

  setPhase: (phase: Phase) => void
  answerQuestion: <K extends keyof WizardAnswers>(key: K, value: WizardAnswers[K]) => void
  setStep: (step: number) => void
  toggleStyle: (styleId: string, text: string) => void
  removeSignature: (id: string) => void
  clearNotice: () => void
  reset: () => void
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
      notice: null,

      setPhase: (phase) => set({ phase }),

      answerQuestion: (key, value) =>
        set((s) => ({ answers: { ...s.answers, [key]: value } })),

      setStep: (currentStep) => set({ currentStep }),

      toggleStyle: (styleId, text) => {
        const { selected } = get()
        const id = `${styleId}::${text}`
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

      removeSignature: (id) =>
        set((s) => ({ selected: s.selected.filter((sig) => sig.id !== id) })),

      clearNotice: () => set({ notice: null }),

      reset: () => set({ phase: 'landing', answers: {}, currentStep: 0, selected: [], notice: null })
    }),
    {
      name: 'handtekening-studio',
      partialize: (s) => ({
        phase: s.phase,
        answers: s.answers,
        currentStep: s.currentStep,
        selected: s.selected
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
