import { useState } from 'react';
import type { EnvVar } from '@flightdeck/protocol';
import { Badge, Button, Card, Drawer, EmptyState, Field, Icon, Textarea } from '@/components/ui';
import type { ControlState } from '@/lib/permissions';

const MASK = '********';

function isMasked(v: string): boolean {
  return v === MASK;
}

export interface EnvPanelProps {
  serviceId: string;
  env: EnvVar[] | undefined;
  canReveal: boolean;
  editState: ControlState;
  onSetEnv: (env: EnvVar[]) => void;
  pending: boolean;
}

/**
 * Environment variables for a service. Values arrive masked from the server
 * unless the caller has the reveal permission; this component never unmasks on
 * its own. Admins get a cosmetic show/hide (the value is already revealed) and an
 * editor that replaces the whole environment via a reveal-gated set_env command.
 */
export function EnvPanel({ env, canReveal, editState, onSetEnv, pending }: EnvPanelProps) {
  const [shown, setShown] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  if (env === undefined) {
    return (
      <Card>
        <EmptyState
          icon="eye-slash"
          title="No environment collected"
          description="The agent only reports environment variables when started with FD_COLLECT_ENV. Enable it on the host to see them here."
        />
      </Card>
    );
  }

  if (env.length === 0) {
    return (
      <Card>
        <EmptyState
          icon="folder-simple"
          title="No variables set"
          description="This service has no environment variables."
        />
      </Card>
    );
  }

  const openEditor = () => {
    setDraft(env.map((e) => `${e.key}=${isMasked(e.value) ? '' : e.value}`).join('\n'));
    setEditing(true);
  };

  const save = () => {
    const next: EnvVar[] = [];
    for (const raw of draft.split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      next.push({ key: line.slice(0, eq).trim(), value: line.slice(eq + 1) });
    }
    onSetEnv(next);
    setEditing(false);
  };

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-sm font-medium text-fg">
          {env.length} variable{env.length === 1 ? '' : 's'}
        </div>
        <Button
          icon="pencil-simple"
          size="sm"
          disabled={!editState.enabled || pending}
          reason={editState.reason}
          onClick={openEditor}
        >
          Edit
        </Button>
      </div>

      {!canReveal ? (
        <div className="flex items-center gap-2 border-b border-line bg-raised px-4 py-2 text-xs text-muted">
          <Icon name="lock-simple" size={14} /> Values are hidden. Reveal requires the admin role.
        </div>
      ) : null}

      <ul className="divide-y divide-line">
        {env.map((e) => {
          const masked = isMasked(e.value);
          const reveal = canReveal && shown[e.key];
          return (
            <li key={e.key} className="flex items-center gap-3 px-4 py-2.5 font-mono text-xs">
              <span className="w-56 shrink-0 truncate text-muted">{e.key}</span>
              <span className="flex-1 truncate text-fg">
                {masked ? <Badge tone="neutral">hidden</Badge> : reveal ? e.value : '•'.repeat(12)}
              </span>
              {canReveal && !masked ? (
                <button
                  type="button"
                  onClick={() => setShown((s) => ({ ...s, [e.key]: !s[e.key] }))}
                  aria-label={reveal ? `Hide ${e.key}` : `Show ${e.key}`}
                  className="shrink-0 text-faint transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  <Icon name={reveal ? 'eye-slash' : 'eye'} size={14} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <Drawer
        open={editing}
        onClose={() => setEditing(false)}
        title="Edit environment"
        width={520}
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={pending}>
              Cancel
            </Button>
            <Button variant="primary" onClick={save} disabled={pending}>
              {pending ? 'Applying…' : 'Save & recreate'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="flex items-start gap-2 rounded-lg border border-line bg-[var(--abg)] p-3 text-xs text-warn">
            <Icon name="warning" size={16} className="mt-0.5 shrink-0" />
            Saving replaces the entire environment and recreates the container. Blank values for
            previously-hidden keys will be written as empty — fill them in first.
          </p>
          <Field label="Variables (KEY=value, one per line)">
            {({ id }) => (
              <Textarea
                id={id}
                mono
                rows={14}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
              />
            )}
          </Field>
        </div>
      </Drawer>
    </Card>
  );
}
