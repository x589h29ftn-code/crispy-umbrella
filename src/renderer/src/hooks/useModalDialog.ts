import { useEffect, useRef } from 'react'

const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Gedeeld gedrag voor alle dialoogvensters: Escape sluit, de Tab-toets blijft
 * binnen het venster en na sluiten keert de focus terug naar de knop waarmee je
 * het opende. Geef de teruggegeven ref aan de dialoogkaart mee.
 */
export function useModalDialog<T extends HTMLElement>(open: boolean, onClose: () => void): React.RefObject<T> {
  const ref = useRef<T>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  useEffect(() => {
    if (!open) return
    const card = ref.current
    const previous = document.activeElement as HTMLElement | null

    const focusable = (): HTMLElement[] =>
      card ? [...card.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null) : []

    if (card && !card.contains(document.activeElement)) {
      const first = focusable()[0]
      if (first) first.focus()
      else card.focus?.()
    }

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation()
        e.preventDefault()
        closeRef.current()
        return
      }
      if (e.key !== 'Tab' || !card) return
      const items = focusable()
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      const active = document.activeElement as HTMLElement | null
      if (e.shiftKey && (active === first || !card.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && active === last) {
        e.preventDefault()
        first.focus()
      }
    }

    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      if (previous && document.contains(previous)) previous.focus()
    }
  }, [open])

  return ref
}
