import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'
import { getGroupBookmarks, type GroupBookmark } from '../lib/bookmarks'
import { CommentsTimeline } from './CommentsPanel'
import { IconBookmark, IconClose, IconComment } from './icons'

interface GroupEntry {
  groupId: string
  groupName: string
  bookmarks: GroupBookmark[]
}

/**
 * Zijpaneel met twee tabbladen: Bladwijzers (de inhoudsopgave van alle open
 * documenten — klikken springt naar de pagina, in het leestabblad of het
 * volledig scherm) en Commentaar (alle opmerkingen op een rij).
 */
export default function BookmarksPanel(): JSX.Element | null {
  const open = useStudioStore((s) => s.bookmarksPanelOpen)
  const setOpen = useStudioStore((s) => s.setBookmarksPanelOpen)
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const openLightbox = useStudioStore((s) => s.openLightbox)
  const [entries, setEntries] = useState<GroupEntry[] | null>(null)
  const [tab, setTab] = useState<'bookmarks' | 'comments'>('bookmarks')

  useEffect(() => {
    if (!open) {
      setEntries(null)
      return
    }
    let cancelled = false
    Promise.all(
      groups.map(async (group) => ({
        groupId: group.id,
        groupName: group.name,
        bookmarks: await getGroupBookmarks(group, sources)
      }))
    )
      .then((all) => {
        if (!cancelled) setEntries(all.filter((e) => e.bookmarks.length))
      })
      .catch(() => {
        if (!cancelled) setEntries([])
      })
    return () => {
      cancelled = true
    }
  }, [open, groups, sources])

  if (!open) return null

  function jumpTo(pageId: string): void {
    // In het actieve leestabblad scrollt de pagina in beeld; anders volledig scherm.
    const target = document.querySelector(`.editor-view .editor-page[data-page-id="${pageId}"]`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    setOpen(false)
    openLightbox(pageId)
  }

  return (
    <aside className="comments-panel bookmarks-panel" onClick={(e) => e.stopPropagation()}>
      <div className="comments-panel__head bookmarks-panel__tabs">
        <button
          type="button"
          className={`bookmarks-panel__tab${tab === 'bookmarks' ? ' bookmarks-panel__tab--active' : ''}`}
          onClick={() => setTab('bookmarks')}
        >
          <IconBookmark size={13} /> Bladwijzers
        </button>
        <button
          type="button"
          className={`bookmarks-panel__tab${tab === 'comments' ? ' bookmarks-panel__tab--active' : ''}`}
          onClick={() => setTab('comments')}
        >
          <IconComment size={13} /> Commentaar
        </button>
        <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten" onClick={() => setOpen(false)}>
          <IconClose size={13} />
        </button>
      </div>
      {tab === 'comments' ? (
        <CommentsTimeline />
      ) : entries === null ? (
        <div className="comments-panel__empty">Inhoudsopgave laden…</div>
      ) : entries.length === 0 ? (
        <div className="comments-panel__empty">
          Geen bladwijzers gevonden in de geopende documenten. Bij het samenvoegen van meerdere bestanden krijgt de
          export automatisch een bladwijzer per brondocument.
        </div>
      ) : (
        <div className="comments-panel__list bookmarks-panel__list">
          {entries.map((entry) => (
            <div key={entry.groupId} className="bookmarks-panel__group">
              <div className="bookmarks-panel__doc">{entry.groupName}</div>
              {entry.bookmarks.map((bm, i) => (
                <button
                  key={i}
                  type="button"
                  className="bookmarks-panel__item"
                  style={{ paddingLeft: 14 + bm.depth * 14 }}
                  onClick={() => jumpTo(bm.pageId)}
                >
                  {bm.title}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
