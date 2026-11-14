import { useId } from 'react';
import { createPortal } from 'react-dom';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { useBodyScrollLock, useFocusTrap } from './overlay';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}

/** A centered modal dialog in a portal, with focus trap, Escape and overlay close. */
export function Modal({ open, onClose, title, description, children, footer }: ModalProps) {
  const titleId = useId();
  const descId = useId();
  const ref = useFocusTrap<HTMLDivElement>(open, onClose);
  useBodyScrollLock(open);
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
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
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-xl border border-line bg-surface shadow-[var(--pop)] outline-none motion-safe:animate-[zoomin_140ms_ease-out]"
      >
        <div className="px-5 pt-5 pb-4">
          <h2 id={titleId} className="text-base font-semibold text-fg">
            {title}
          </h2>
          {description ? (
            <p id={descId} className="mt-1.5 text-sm text-muted">
              {description}
            </p>
          ) : null}
          {children ? <div className="mt-4">{children}</div> : null}
        </div>
        {footer ? (
          <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: ReactNode;
  description?: ReactNode;
  confirmLabel?: string;
  /** Use danger styling for destructive confirmations. */
  danger?: boolean;
  /** Set while the action is in flight to disable the buttons. */
  busy?: boolean;
}

/** A confirm/cancel dialog for actions that need a deliberate second step. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = 'Confirm',
  danger,
  busy,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={busy}>
            {busy ? 'Working…' : confirmLabel}
          </Button>
        </>
      }
    />
  );
}
