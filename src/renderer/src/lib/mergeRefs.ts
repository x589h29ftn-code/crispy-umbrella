import type { MutableRefObject, Ref, RefCallback } from 'react'

export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (!ref) continue
      if (typeof ref === 'function') ref(node)
      else (ref as MutableRefObject<T | null>).current = node
    }
  }
}
