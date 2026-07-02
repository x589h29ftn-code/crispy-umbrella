import { useStudioStore } from '../store'
import { IconClose } from './icons'

export default function Toasts(): JSX.Element | null {
  const toasts = useStudioStore((s) => s.toasts)
  const dismissToast = useStudioStore((s) => s.dismissToast)

  if (!toasts.length) return null

  return (
    <div className="toasts" role="status">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast--${toast.kind}`}>
          <span className="toast__message">{toast.message}</span>
          <button
            type="button"
            className="icon-btn icon-btn--chrome"
            title="Sluiten"
            onClick={() => dismissToast(toast.id)}
          >
            <IconClose size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
