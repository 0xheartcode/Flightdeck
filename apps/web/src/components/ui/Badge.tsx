import type { ReactNode } from 'react';
import type { DeployStatus, ServiceState } from '@flightdeck/protocol';

export type Tone = 'neutral' | 'accent' | 'ok' | 'danger' | 'warn' | 'info';

const TONES: Record<Tone, string> = {
  neutral: 'text-muted bg-[var(--nbg)]',
  accent: 'text-[var(--ai)] bg-[var(--abg)]',
  ok: 'text-ok bg-[var(--gbg)]',
  danger: 'text-danger bg-[var(--rbg)]',
  warn: 'text-warn bg-[var(--abg)]',
  info: 'text-link bg-[var(--nbg)]',
};

export interface BadgeProps {
  tone?: Tone;
  /** Show a leading status dot in the current tone color. */
  dot?: boolean;
  children: ReactNode;
  className?: string;
}

/** A small, rounded status label. */
export function Badge({ tone = 'neutral', dot, children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]} ${className}`}
    >
      {dot ? <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  );
}

const SERVICE_TONE: Record<ServiceState, Tone> = {
  running: 'ok',
  restarting: 'warn',
  paused: 'info',
  created: 'neutral',
  exited: 'danger',
  dead: 'danger',
  removing: 'neutral',
  unknown: 'neutral',
};

/** Service runtime state as a tone-coded pill with a status dot. */
export function StatusPill({ state }: { state: ServiceState }) {
  return (
    <Badge tone={SERVICE_TONE[state]} dot>
      {state}
    </Badge>
  );
}

const DEPLOY_TONE: Record<DeployStatus, Tone> = {
  success: 'ok',
  failure: 'danger',
  in_progress: 'warn',
  pending: 'neutral',
  cancelled: 'neutral',
};

const DEPLOY_LABEL: Record<DeployStatus, string> = {
  success: 'Success',
  failure: 'Failed',
  in_progress: 'In progress',
  pending: 'Pending',
  cancelled: 'Cancelled',
};

/** GitHub Actions deploy status as a tone-coded pill. */
export function DeployStatusPill({ status }: { status: DeployStatus }) {
  return (
    <Badge tone={DEPLOY_TONE[status]} dot>
      {DEPLOY_LABEL[status]}
    </Badge>
  );
}
