import { useStudioStore } from '../store'

/**
 * Pointer-based drag and drop for page thumbnails and document rows.
 *
 * HTML5 drag-and-drop proved unreliable inside Electron (drags aborting right
 * after dragstart) and only offers a static snapshot ghost. This controller
 * implements press-and-hold dragging with plain pointer events: a live ghost
 * follows the cursor, drop targets are hit-tested with elementFromPoint, and
 * the drop indicator state lives in the store so rows can render it.
 */

type ActiveDrag =
  | { kind: 'pages'; ids: string[] }
  | { kind: 'group'; groupId: string }

let activeDrag: ActiveDrag | null = null
let ghostEl: HTMLDivElement | null = null
let suppressClickUntil = 0

/** Click handlers call this to ignore the click that follows a finished or cancelled drag. One-shot. */
export function consumeDragClick(): boolean {
  const suppressed = performance.now() < suppressClickUntil
  suppressClickUntil = 0
  return suppressed
}

function createGhost(inner: HTMLElement, count: number): void {
  removeGhost()
  ghostEl = document.createElement('div')
  ghostEl.className = 'drag-ghost'
  ghostEl.appendChild(inner)
  if (count > 1) {
    const badge = document.createElement('span')
    badge.className = 'drag-ghost__badge'
    badge.textContent = String(count)
    ghostEl.appendChild(badge)
  }
  document.body.appendChild(ghostEl)
}

function moveGhost(x: number, y: number): void {
  if (ghostEl) ghostEl.style.transform = `translate(${x + 14}px, ${y + 14}px)`
}

function removeGhost(): void {
  ghostEl?.remove()
  ghostEl = null
}

export function beginPagesDrag(ids: string[], thumbUrl: string | null, x: number, y: number): void {
  activeDrag = { kind: 'pages', ids }
  useStudioStore.getState().setDragPageIds(ids)
  const inner = document.createElement(thumbUrl ? 'img' : 'div')
  inner.className = 'drag-ghost__thumb'
  if (thumbUrl) (inner as HTMLImageElement).src = thumbUrl
  createGhost(inner, ids.length)
  moveGhost(x, y)
  document.body.classList.add('is-dragging')
}

export function beginGroupDrag(groupId: string, name: string, x: number, y: number): void {
  activeDrag = { kind: 'group', groupId }
  useStudioStore.getState().setDragGroupId(groupId)
  const inner = document.createElement('div')
  inner.className = 'drag-ghost__label'
  inner.textContent = name
  createGhost(inner, 1)
  moveGhost(x, y)
  document.body.classList.add('is-dragging')
}

export function updateDrag(x: number, y: number): void {
  if (!activeDrag) return
  moveGhost(x, y)
  const state = useStudioStore.getState()

  const el = document.elementFromPoint(x, y) as HTMLElement | null
  if (!el) {
    state.setDropTarget(null)
    state.setGroupDropIndex(null)
    return
  }

  if (activeDrag.kind === 'pages') {
    const thumb = el.closest<HTMLElement>('.page-thumb[data-page-id]')
    if (thumb) {
      const groupEl = thumb.closest<HTMLElement>('.group-row[data-group-id]')
      const rect = thumb.getBoundingClientRect()
      const edge: 'before' | 'after' = x - rect.left < rect.width / 2 ? 'before' : 'after'
      if (groupEl) {
        state.setDropTarget({
          type: 'slot',
          groupId: groupEl.dataset.groupId!,
          index: Number(thumb.dataset.index ?? 0),
          edge
        })
        return
      }
    }
    const pagesRow = el.closest<HTMLElement>('.group-row__pages')
    const groupEl = pagesRow?.closest<HTMLElement>('.group-row[data-group-id]')
    if (pagesRow && groupEl) {
      const groupId = groupEl.dataset.groupId!
      const group = state.groups.find((g) => g.id === groupId)
      state.setDropTarget({
        type: 'slot',
        groupId,
        index: Math.max(0, (group?.pages.length ?? 1) - 1),
        edge: 'after'
      })
      return
    }
    if (el.closest('.group-row')) {
      // On a row but not over the pages strip (header etc.) — no target.
      state.setDropTarget(null)
      return
    }
    state.setDropTarget(el.closest('.canvas-viewport') ? { type: 'canvas' } : null)
    return
  }

  // group drag
  const rowEl = el.closest<HTMLElement>('.group-row[data-group-index]')
  if (rowEl) {
    const rect = rowEl.getBoundingClientRect()
    const index = Number(rowEl.dataset.groupIndex ?? 0)
    state.setGroupDropIndex(y - rect.top < rect.height / 2 ? index : index + 1)
  } else if (el.closest('.canvas-viewport')) {
    state.setGroupDropIndex(state.groups.length)
  } else {
    state.setGroupDropIndex(null)
  }
}

export function finishDrag(): void {
  if (!activeDrag) return
  const state = useStudioStore.getState()

  if (activeDrag.kind === 'pages') {
    const target = state.dropTarget
    const ids = activeDrag.ids
    if (target?.type === 'slot') {
      state.movePages(ids, target.groupId, target.edge === 'before' ? target.index : target.index + 1)
    } else if (target?.type === 'canvas') {
      state.createGroupWithPages(ids)
    }
  } else {
    const index = state.groupDropIndex
    if (index != null) state.reorderGroups(activeDrag.groupId, index)
  }

  cancelDrag()
  suppressClickUntil = performance.now() + 250
}

export function cancelDrag(): void {
  if (!activeDrag) return
  activeDrag = null
  // The pointer is still down; the release that follows must not count as a click.
  suppressClickUntil = performance.now() + 2000
  removeGhost()
  document.body.classList.remove('is-dragging')
  const state = useStudioStore.getState()
  state.setDragPageIds(null)
  state.setDragGroupId(null)
  state.setDropTarget(null)
  state.setGroupDropIndex(null)
}

export function isDragActive(): boolean {
  return activeDrag !== null
}
