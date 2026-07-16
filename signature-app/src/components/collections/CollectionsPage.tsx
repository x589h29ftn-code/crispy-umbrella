import { useEffect, useMemo } from 'react'
import { MAX_COLLECTIONS, MAX_STYLES, useAppStore, usedCollectionCount } from '../../store'
import { STYLES } from '../../data/collections'
import { deriveParams, sortedCollections } from '../../engine/suggest'
import { StyleCard } from './StyleCard'

export function CollectionsPage() {
  const answers = useAppStore((s) => s.answers)
  const selected = useAppStore((s) => s.selected)
  const notice = useAppStore((s) => s.notice)
  const clearNotice = useAppStore((s) => s.clearNotice)
  const setPhase = useAppStore((s) => s.setPhase)

  const params = useMemo(() => deriveParams(answers), [answers])
  const collections = useMemo(() => sortedCollections(answers), [answers])

  useEffect(() => {
    if (!notice) return
    const t = setTimeout(clearNotice, 3500)
    return () => clearTimeout(t)
  }, [notice, clearNotice])

  const collectionsUsed = usedCollectionCount(selected)

  return (
    <div className="collections-page">
      <header className="page-header">
        <button className="btn-ghost" onClick={() => setPhase('wizard')}>← Vragenlijst</button>
        <div className="page-header-info">
          <h1>Kies je stijlen</h1>
          <p>
            Kies maximaal <strong>{MAX_STYLES} stijlen</strong> uit maximaal{' '}
            <strong>{MAX_COLLECTIONS} collecties</strong>. De collecties staan gesorteerd op wat het
            best bij je antwoorden past.
          </p>
        </div>
        <div className="selection-counter" aria-live="polite">
          <span>{selected.length} / {MAX_STYLES} stijlen</span>
          <span>{collectionsUsed} / {MAX_COLLECTIONS} collecties</span>
        </div>
      </header>

      {collections.map((collection) => (
        <section key={collection.id} className="collection-section">
          <div className="collection-title">
            <h2>{collection.name}</h2>
            <p>{collection.description}</p>
          </div>
          <div className="style-grid">
            {collection.styleIds.map((styleId) => {
              const style = STYLES.find((s) => s.id === styleId)
              if (!style) return null
              return (
                <StyleCard key={styleId} style={style} collection={collection} params={params} />
              )
            })}
          </div>
        </section>
      ))}

      <footer className="page-footer">
        <button
          className="btn-primary btn-large"
          disabled={selected.length === 0}
          onClick={() => setPhase('results')}
        >
          Naar mijn handtekeningen ({selected.length}) →
        </button>
      </footer>

      {notice && <div className="toast" role="alert">{notice}</div>}
    </div>
  )
}
