import { useMemo } from 'react'
import { useStudioStore } from '../store'
import { formatCommentTime } from './Lightbox'
import { IconCheck, IconClose, IconComment } from './icons'

/**
 * Timeline of every comment in the project, newest first. Clicking an entry
 * jumps straight to the thread on that page in the full-screen viewer.
 */
export default function CommentsPanel(): JSX.Element | null {
  const open = useStudioStore((s) => s.commentsPanelOpen)
  const setOpen = useStudioStore((s) => s.setCommentsPanelOpen)
  const groups = useStudioStore((s) => s.groups)
  const openCommentThread = useStudioStore((s) => s.openCommentThread)
  const updateComment = useStudioStore((s) => s.updateComment)

  const items = useMemo(
    () =>
      groups
        .flatMap((group) =>
          group.pages.flatMap((page, pageIndex) =>
            page.comments.map((comment) => ({
              comment,
              pageId: page.id,
              groupName: group.name,
              pageNumber: pageIndex + 1
            }))
          )
        )
        .sort((a, b) => b.comment.createdAt - a.comment.createdAt),
    [groups]
  )

  if (!open) return null

  return (
    <aside className="comments-panel" onClick={(e) => e.stopPropagation()}>
      <div className="comments-panel__head">
        <IconComment size={15} />
        <span>Opmerkingen</span>
        <span className="comments-panel__count">{items.filter((i) => !i.comment.resolved).length} open</span>
        <button type="button" className="icon-btn icon-btn--chrome" title="Sluiten" onClick={() => setOpen(false)}>
          <IconClose size={13} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="comments-panel__empty">
          Nog geen opmerkingen. Open een pagina en kies "Commentaar" om er een te plaatsen.
        </div>
      ) : (
        <div className="comments-panel__list">
          {items.map(({ comment, pageId, groupName, pageNumber }) => (
            <div
              key={comment.id}
              className={`comments-panel__item${comment.resolved ? ' comments-panel__item--resolved' : ''}`}
              onClick={() => openCommentThread(pageId, comment.id)}
              title="Klik om naar deze opmerking te gaan"
            >
              <div className="comments-panel__meta">
                <span className="comments-panel__time">{formatCommentTime(comment.createdAt)}</span>
                <span className="comments-panel__where">
                  {groupName} · pagina {pageNumber}
                </span>
              </div>
              <div className="comments-panel__text">{comment.text}</div>
              <div className="comments-panel__foot">
                {comment.replies.length > 0 && (
                  <span className="comments-panel__replies">
                    {comment.replies.length} {comment.replies.length === 1 ? 'reactie' : 'reacties'}
                  </span>
                )}
                <label
                  className="comments-panel__resolve"
                  onClick={(e) => e.stopPropagation()}
                  title="Markeer als afgehandeld"
                >
                  <input
                    type="checkbox"
                    checked={comment.resolved}
                    onChange={(e) => updateComment(pageId, comment.id, { resolved: e.target.checked })}
                  />
                  {comment.resolved ? (
                    <span className="comments-panel__done">
                      <IconCheck size={11} /> afgehandeld
                    </span>
                  ) : (
                    'afvinken'
                  )}
                </label>
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  )
}
