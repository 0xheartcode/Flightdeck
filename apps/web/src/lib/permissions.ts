import type { Me } from '@/api';

/**
 * The single source of truth for "may the current user do X, and if not why".
 * The server enforces every permission authoritatively (client-hub.ts); this
 * only decides what the UI shows. Three permissions exist: `view` (everyone),
 * `act` (restart/redeploy — operator or admin), `reveal` (unmask + edit env —
 * admin). When identity is off, the caller holds all permissions, matching the
 * control plane's legacyPermissions().
 */
export type Perm = 'view' | 'act' | 'reveal';

export type PermAction = 'restart' | 'redeploy' | 'reveal_env' | 'edit_env';

/** How a gated control should render for the current user. */
export interface ControlState {
  /** Whether to render the control at all. */
  visible: boolean;
  /** Whether it is interactive (false → disabled). */
  enabled: boolean;
  /** Human-readable reason shown when disabled. */
  reason?: string;
}

const REQUIRED: Record<PermAction, Exclude<Perm, 'view'>> = {
  restart: 'act',
  redeploy: 'act',
  reveal_env: 'reveal',
  edit_env: 'reveal',
};

const REASON: Record<Exclude<Perm, 'view'>, string> = {
  act: 'Requires the operator role',
  reveal: 'Requires the admin role',
};

export interface Permissions {
  identityEnabled: boolean;
  /** True once the caller is known to be a signed-in principal (or identity is off). */
  authenticated: boolean;
  has: (perm: Perm) => boolean;
  /** How a given gated action should render. */
  can: (action: PermAction) => ControlState;
}

/**
 * Resolve permissions from GET /api/me. `unauthorized` is passed when a 401 was
 * seen (identity on, not signed in) so the UI can route to sign-in even before
 * /api/me succeeds.
 */
export function permissionsFrom(me: Me | undefined, unauthorized = false): Permissions {
  const identityEnabled = me?.identityEnabled ?? unauthorized;
  const set = new Set<Perm>(me?.permissions ?? []);
  const authenticated = identityEnabled ? Boolean(me?.subject) : true;

  const has = (perm: Perm): boolean => (identityEnabled ? set.has(perm) : true);

  const can = (action: PermAction): ControlState => {
    const need = REQUIRED[action];
    if (has(need)) return { visible: true, enabled: true };
    // §1: a read-only user sees gated controls "clearly disabled with the
    // reason", never a control that silently no-ops.
    return { visible: true, enabled: false, reason: REASON[need] };
  };

  return { identityEnabled, authenticated, has, can };
}
