import { useId } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useBodyScrollLock, useFocusTrap } from './overlay';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  /** Footer actions, pinned to the bottom. */
  footer?: ReactNode;
  /** Drawer width. Defaults to a comfortable editor width. */
  width?: number;
}

/**
 * A right-hand side drawer rendered in a portal. Focus is trapped while open,
 * Escape and the overlay close it, body scroll is locked, and focus returns to
 * the trigger on close. Labelled as a dialog for assistive tech.
 */
export function Drawer({ open, onClose, title, children, footer, width = 460 }: DrawerProps) {
  const titleId = useId();
  const ref = useFocusTrap<HTMLDivElement>(open, onClose);
  useBodyScrollLock(open);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-[var(--overlay)] motion-safe:animate-[fadein_120ms_ease-out]"
      />
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ width: `min(${width}px, 100vw)` }}
        className="absolute top-0 right-0 flex h-full flex-col border-l border-line bg-surface shadow-[var(--pop)] outline-none motion-safe:animate-[slidein_160ms_ease-out]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 id={titleId} className="text-sm font-semibold text-fg">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-row hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
          >
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto px-4 py-4">{children}</div>
        {footer ? (
          <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
