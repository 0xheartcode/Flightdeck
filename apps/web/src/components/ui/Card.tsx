import type { ReactNode } from 'react';

export interface CardProps {
  children: ReactNode;
  className?: string;
  /** Use the raised surface (bg2) instead of the default surface (bg1). */
  raised?: boolean;
}

export function Card({ children, className = '', raised }: CardProps) {
  return (
    <div
      className={`rounded-xl border border-line ${raised ? 'bg-raised' : 'bg-surface'} ${className}`}
    >
      {children}
    </div>
  );
}

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Right-aligned controls (buttons, filters). */
  actions?: ReactNode;
}

export function CardHeader({ title, subtitle, actions }: CardHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <h2 className="truncate text-sm font-semibold text-fg">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-xs text-faint">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={`px-4 py-3 ${className}`}>{children}</div>;
}
