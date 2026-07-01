import { useEffect, type RefObject } from 'react'

export function useClickOutside(ref: RefObject<HTMLElement>, active: boolean, onOutside: () => void): void {
  useEffect(() => {
    if (!active) return
    function onPointerDown(e: PointerEvent): void {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [active, ref, onOutside])
}
