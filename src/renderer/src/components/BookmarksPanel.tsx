import { useEffect, useState } from 'react'
import { useStudioStore } from '../store'
import { getGroupBookmarks, type GroupBookmark } from '../lib/bookmarks'
import { IconBookmark, IconClose } from './icons'

interface GroupEntry {
  groupId: string
  groupName: string
  bookmarks: GroupBookmark[]
}

/**
 * Bladwijzers/inhoudsopgave: the bookmark trees of all open documents.
 * Clicking an entry jumps straight to that page in the full-screen viewer.
 */
export default function BookmarksPanel(): JSX.Element | null {
  const open = useStudioStore((s) => s.bookmarksPanelOpen)
  const setOpen = useStudioStore((s) => s.setBookmarksPanelOpen)
  const groups = useStudioStore((s) => s.groups)
  const sources = useStudioStore((s) => s.sources)
  const openLightbox = useStudioStore((s) => s.openLightbox)
  const [entries, setEntries] = useState<GroupEntry[] | null>(null)

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

  return (
    <aside className="comments-panel bookmarks-panel" onClick={(e) => e.stopPropagation()}>
      <div className="comments-panel__head">
        <IconBookmark size={15} />
        <span>Bladwijzers</span>
        <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten" onClick={() => setOpen(false)}>
          <IconClose size={13} />
        </button>
      </div>
      {entries === null ? (
        <div className="comments-panel__empty">Inhoudsopgave laden…</div>
      ) : entries.length === 0 ? (
        <div className="comments-panel__empty">
          Geen bladwijzers gevonden. Bij het samenvoegen van meerdere bestanden krijgt de export automatisch een
          bladwijzer per brondocument.
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
                  onClick={() => {
                    setOpen(false)
                    openLightbox(bm.pageId)
                  }}
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
