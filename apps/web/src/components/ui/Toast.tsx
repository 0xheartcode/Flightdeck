import { createContext, useCallback, useContext, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

type ToastTone = 'info' | 'ok' | 'danger' | 'warn';

interface Toast {
  id: number;
  tone: ToastTone;
  message: ReactNode;
}

interface ToastApi {
  show: (message: ReactNode, tone?: ToastTone) => void;
  success: (message: ReactNode) => void;
  error: (message: ReactNode) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const TONE_ICON: Record<ToastTone, IconName> = {
  info: 'bell',
  ok: 'check-circle',
  danger: 'warning-octagon',
  warn: 'warning',
};

const TONE_FG: Record<ToastTone, string> = {
  info: 'text-link',
  ok: 'text-ok',
  danger: 'text-danger',
  warn: 'text-warn',
};

/** Wrap the app so any component can raise a toast via useToast(). */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const show = useCallback(
    (message: ReactNode, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setToasts((prev) => [...prev, { id, tone, message }]);
      window.setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const api: ToastApi = {
    show,
    success: (m) => show(m, 'ok'),
    error: (m) => show(m, 'danger'),
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      {createPortal(
        <div
          aria-live="polite"
          aria-atomic="false"
          className="pointer-events-none fixed right-4 bottom-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              role="status"
              className="pointer-events-auto flex items-start gap-2.5 rounded-lg border border-line bg-raised px-3 py-2.5 shadow-[var(--pop)] motion-safe:animate-[slideup_160ms_ease-out]"
            >
              <Icon
                name={TONE_ICON[t.tone]}
                size={16}
                className={`mt-0.5 shrink-0 ${TONE_FG[t.tone]}`}
              />
              <div className="flex-1 text-sm text-fg">{t.message}</div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="shrink-0 rounded text-faint transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');
  return ctx;
}
