import { useLayoutEffect, useRef, useState } from 'react'

/**
 * Plaatst een uitklapmenu naast zijn knop in het schuifbare deel van de zijbalk.
 * Het menu blijft in de DOM bij zijn knop staan (handig voor klik-buiten), maar
 * wordt ten opzichte van het venster gepositioneerd — anders knipt het
 * schuifgebied het af.
 */
export function useAnchoredFlyout(open: boolean): {
  anchorRef: React.RefObject<HTMLDivElement>
  flyoutRef: React.RefObject<HTMLDivElement>
  style: { top: number; left: number } | undefined
} {
  const anchorRef = useRef<HTMLDivElement>(null)
  const flyoutRef = useRef<HTMLDivElement>(null)
  const [style, setStyle] = useState<{ top: number; left: number } | undefined>()

  useLayoutEffect(() => {
    if (!open) {
      setStyle(undefined)
      return
    }
    function place(): void {
      const anchor = anchorRef.current
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      const height = flyoutRef.current?.offsetHeight ?? 0
      setStyle({
        top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)),
        left: rect.right + 10
      })
    }
    place()
    window.addEventListener('resize', place)
    // Meebewegen wanneer de zijbalk (of iets anders) scrollt.
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  return { anchorRef, flyoutRef, style }
}
