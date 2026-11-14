import type { ReactNode } from 'react';
import { Icon, type IconName } from '@/components/ui';

/** Standard page padding + max width wrapper. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</div>;
}

export interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  /** Optional back link rendered before the title. */
  back?: { label: string; onClick: () => void };
}

export function PageHeader({ title, subtitle, actions, back }: PageHeaderProps) {
  return (
    <div className="mb-5">
      {back ? (
        <button
          type="button"
          onClick={back.onClick}
          className="mb-2 inline-flex items-center gap-1 text-xs text-muted transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
        >
          <Icon name="arrow-left" size={14} /> {back.label}
        </button>
      ) : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-fg">{title}</h1>
          {subtitle ? <p className="mt-0.5 text-sm text-muted">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}

/** A compact metric tile for the overview stat row. */
export function StatCard({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: ReactNode;
  icon: IconName;
  tone?: 'ok' | 'danger' | 'warn';
}) {
  const fg =
    tone === 'danger'
      ? 'text-danger'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'ok'
          ? 'text-ok'
          : 'text-fg';
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-sunken text-faint">
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0">
        <div className={`text-lg leading-tight font-semibold tabular-nums ${fg}`}>{value}</div>
        <div className="text-xs text-faint">{label}</div>
      </div>
    </div>
  );
}
