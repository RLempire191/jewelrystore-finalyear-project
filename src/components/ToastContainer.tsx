import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useStore } from '../lib/store'
import type { Toast } from '../lib/types'

export function ToastContainer() {
  const { toasts, toastPosition } = useStore()

  if (toasts.length === 0) {
    return null
  }

  return (
    createPortal(
      <div
        className={`toast-container toast-container--${toastPosition}`}
        role="region"
        aria-label="Notifications"
      >
        {toasts.map((toast) => (
          <ToastItem
            key={toast.id}
            toast={toast}
            position={toastPosition}
          />
        ))}
      </div>,
      document.body,
    )
  )
}

function ToastItem({ toast, position }: { toast: Toast; position: 'top' | 'bottom' }) {
  const { dismissToast } = useStore()
  const [isExiting, setIsExiting] = useState(false)
  const [progress, setProgress] = useState(100)
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleDismiss = useCallback(() => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current)
    }
    setIsExiting(true)
    exitTimerRef.current = setTimeout(() => {
      dismissToast(toast.id)
    }, 300) // matches CSS slide-out duration
  }, [dismissToast, toast.id])

  useEffect(() => {
    const duration = toast.duration ?? 4000
    if (duration <= 0) return

    const timer = setTimeout(() => {
      handleDismiss()
    }, duration)

    return () => clearTimeout(timer)
  }, [handleDismiss, toast.duration])

  useEffect(() => {
    const duration = toast.duration ?? 4000
    if (duration <= 0) return

    const startTime = Date.now()
    const interval = setInterval(() => {
      const elapsed = Date.now() - startTime
      const remaining = Math.max(0, 100 - (elapsed / duration) * 100)
      setProgress(remaining)
      if (remaining === 0) {
        clearInterval(interval)
      }
    }, 16)

    return () => clearInterval(interval)
  }, [toast.duration])

  useEffect(() => () => {
    if (exitTimerRef.current) {
      clearTimeout(exitTimerRef.current)
    }
  }, [])

  const slideClass = isExiting
    ? (position === 'top' ? 'toast-item--slide-out-top' : 'toast-item--slide-out-bottom')
    : (position === 'top' ? 'toast-item--slide-in-top' : 'toast-item--slide-in-bottom')

  return (
    <div
      className={`toast-item ${slideClass} toast-item--${toast.type || 'gold'}`}
      role={toast.type === 'error' ? 'alert' : 'status'}
      aria-live={toast.type === 'error' ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      {toast.icon && (
        <span className="material-symbols-outlined toast-icon">{toast.icon}</span>
      )}
      <div className="toast-content">
        <div className="toast-title">{toast.message}</div>
        {toast.description && <div className="toast-description">{toast.description}</div>}
        {toast.action && (
          <div className="toast-actions">
            <button
              type="button"
              className="toast-action-btn"
              onClick={() => {
                toast.action?.onClick()
                handleDismiss()
              }}
            >
              {toast.action.label}
            </button>
          </div>
        )}
      </div>
      <button
        type="button"
        className="toast-close"
        onClick={handleDismiss}
        aria-label="Dismiss notification"
      >
        <span className="material-symbols-outlined" style={{ fontSize: '1.25rem' }}>close</span>
      </button>

      {/* Premium ticking gold progress bar at the bottom */}
      {toast.duration !== 0 && (
        <div
          className="toast-progress-bar"
          style={{ width: `${progress}%` }}
        />
      )}
    </div>
  )
}
