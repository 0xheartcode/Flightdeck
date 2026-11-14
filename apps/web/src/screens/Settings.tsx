import { useState } from 'react';
import type { Me } from '@/api';
import { Badge, Card, EmptyState, Icon, Tabs } from '@/components/ui';
import type { Route } from '@/lib/router';
import { Page, PageHeader } from './parts';

export interface SettingsProps {
  me?: Me;
  tab?: string;
  onNavigate: (route: Route) => void;
}

function FlagRow({ label, on, help }: { label: string; on: boolean; help: string }) {
  return (
    <li className="flex items-center justify-between gap-3 px-4 py-3">
      <div>
        <div className="text-sm text-fg">{label}</div>
        <div className="text-xs text-faint">{help}</div>
      </div>
      <Badge tone={on ? 'ok' : 'neutral'} dot>
        {on ? 'enabled' : 'disabled'}
      </Badge>
    </li>
  );
}

/**
 * Settings is read-only: identity, roles and server feature flags all come from
 * GET /api/me. Token and variable management shown in the design has no write
 * endpoint (see COVERAGE.md), so those are surfaced as operator-managed notes
 * rather than editable forms.
 */
export function Settings({ me, tab = 'account', onNavigate }: SettingsProps) {
  const [active, setActive] = useState(tab);

  const tabs = [
    { id: 'account', label: 'Account' },
    { id: 'server', label: 'Server' },
    { id: 'access', label: 'Access' },
  ];

  return (
    <Page>
      <PageHeader
        title="Settings"
        subtitle="Your identity and this control plane's configuration."
      />
      <Tabs tabs={tabs} active={active} onChange={setActive} label="Settings sections" />
      <div className="mt-4">
        {active === 'account' ? (
          <Card>
            {me?.identityEnabled ? (
              me.subject ? (
                <ul className="divide-y divide-line">
                  <li className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-muted">Signed in as</span>
                    <span className="text-sm font-medium text-fg">{me.name ?? me.subject}</span>
                  </li>
                  <li className="flex items-center justify-between px-4 py-3">
                    <span className="text-sm text-muted">Subject</span>
                    <span className="font-mono text-xs text-fg">{me.subject}</span>
                  </li>
                  <li className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="text-sm text-muted">Roles</span>
                    <span className="flex flex-wrap justify-end gap-1">
                      {me.roles.length ? (
                        me.roles.map((r) => (
                          <Badge key={r} tone="info">
                            {r}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-faint">none</span>
                      )}
                    </span>
                  </li>
                </ul>
              ) : (
                <EmptyState
                  icon="sign-in"
                  title="Not signed in"
                  description="Sign in to see your account details."
                />
              )
            ) : (
              <EmptyState
                icon="lock-simple"
                title="Identity is disabled"
                description="This control plane runs without identity (legacy mode); every caller has full permissions."
              />
            )}
          </Card>
        ) : null}

        {active === 'server' ? (
          <Card>
            <ul className="divide-y divide-line">
              <FlagRow
                label="Identity"
                on={Boolean(me?.identityEnabled)}
                help="OIDC/JWT authentication is required."
              />
              <FlagRow
                label="Browser login"
                on={Boolean(me?.loginFlow)}
                help="The sign-in redirect flow is available."
              />
              <FlagRow
                label="Actions"
                on={me?.actionsEnabled ?? true}
                help="Restart / redeploy / set-env are permitted (FD_ENABLE_ACTIONS)."
              />
              <FlagRow
                label="Durable log search"
                on={Boolean(me?.logSearch)}
                help="Loki history search is configured."
              />
            </ul>
          </Card>
        ) : null}

        {active === 'access' ? (
          <Card>
            <div className="border-b border-line px-4 py-3">
              <div className="text-sm font-medium text-fg">Your permissions</div>
              <div className="text-xs text-faint">Server-enforced; the UI only reflects them.</div>
            </div>
            <ul className="divide-y divide-line">
              {(['view', 'act', 'reveal'] as const).map((p) => {
                const has = !me?.identityEnabled || me.permissions.includes(p);
                return (
                  <li key={p} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <div className="text-sm text-fg capitalize">{p}</div>
                      <div className="text-xs text-faint">
                        {p === 'view'
                          ? 'See services, logs and status.'
                          : p === 'act'
                            ? 'Restart and redeploy services.'
                            : 'Reveal and edit environment variables.'}
                      </div>
                    </div>
                    <Icon
                      name={has ? 'check-circle' : 'prohibit'}
                      size={18}
                      className={has ? 'text-ok' : 'text-faint'}
                      label={has ? 'granted' : 'not granted'}
                    />
                  </li>
                );
              })}
            </ul>
            <div className="flex items-start gap-2 border-t border-line px-4 py-3 text-xs text-muted">
              <Icon name="key" size={14} className="mt-0.5 shrink-0" />
              <span>
                Agent tokens and service variables are managed by the operator on the host, not from
                this UI. See the{' '}
                <button
                  type="button"
                  onClick={() => onNavigate({ name: 'overview' })}
                  className="text-link hover:underline"
                >
                  Connect agent
                </button>{' '}
                guide.
              </span>
            </div>
          </Card>
        ) : null}
      </div>
    </Page>
  );
}
