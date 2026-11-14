import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export interface EmptyStateProps {
  icon?: IconName;
  title: string;
  /** What the user should do next. Keep it actionable. */
  description?: ReactNode;
  action?: ReactNode;
  /** Use danger styling for error states. */
  tone?: 'neutral' | 'danger';
}

/** Centered placeholder for empty, no-results and error states. */
export function EmptyState({
  icon,
  title,
  description,
  action,
  tone = 'neutral',
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      {icon ? (
        <div
          className={`flex h-11 w-11 items-center justify-center rounded-full ${
            tone === 'danger' ? 'bg-[var(--rbg)] text-danger' : 'bg-sunken text-faint'
          }`}
        >
          <Icon name={icon} size={22} />
        </div>
      ) : null}
      <div className="max-w-sm">
        <p className="text-sm font-medium text-fg">{title}</p>
        {description ? <p className="mt-1 text-xs text-faint">{description}</p> : null}
      </div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
