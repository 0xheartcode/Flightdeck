import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  Icon,
  Tabs,
  useToast,
  type Tone,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';
import { getTransmitter } from '@/lib/transmitter/client';
import {
  CHANNEL_META,
  type Channel,
  type RouteRule,
  type Severity,
  type TransmitterClient,
} from '@/lib/transmitter/types';
import { Page, PageHeader } from './parts';
import { ChannelEditor, OneTimeTokenModal, RouteEditor } from './TransmitterEditors';

const SEVERITY_TONE: Record<Severity, Tone> = {
  info: 'info',
  warning: 'warn',
  error: 'danger',
  critical: 'danger',
};

export interface TransmitterProps {
  /** True when the real backend is available; false shows the mock preview. */
  backendAvailable: boolean;
}

export function Transmitter({ backendAvailable }: TransmitterProps) {
  const client = getTransmitter(backendAvailable);
  const [tab, setTab] = useState('signals');
  // Design order: signals -> sources -> routes -> channels, then the delivery log.
  const tabs = [
    { id: 'signals', label: 'Signals' },
    { id: 'sources', label: 'Sources' },
    { id: 'routes', label: 'Routes' },
    { id: 'channels', label: 'Channels' },
    { id: 'deliveries', label: 'Delivery log' },
  ];

  return (
    <Page>
      <PageHeader
        title="Transmitter"
        subtitle="Route Flightdeck and inbound events to the channels your team watches."
      />
      {!backendAvailable ? (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-line bg-[var(--abg)] px-3 py-2 text-xs text-warn">
          <Icon name="flask" size={14} className="shrink-0" />
          Preview: no Transmitter backend is configured, so this shows mock data. Nothing is sent.
        </div>
      ) : null}
      <Tabs tabs={tabs} active={tab} onChange={setTab} label="Transmitter sections" />
      <div className="mt-4">
        {tab === 'signals' ? <SignalsTab client={client} /> : null}
        {tab === 'sources' ? <SourcesTab client={client} /> : null}
        {tab === 'routes' ? <RoutesTab client={client} /> : null}
        {tab === 'channels' ? <ChannelsTab client={client} /> : null}
        {tab === 'deliveries' ? <DeliveriesTab client={client} /> : null}
      </div>
    </Page>
  );
}

function SignalsTab({ client }: { client: TransmitterClient }) {
  const qc = useQueryClient();
  const signals = useQuery({ queryKey: ['tx', 'signals'], queryFn: () => client.listSignals() });
  const invalidate = () => qc.invalidateQueries({ queryKey: ['tx', 'signals'] });
  const markAll = useMutation({ mutationFn: () => client.markAllRead(), onSuccess: invalidate });
  const markOne = useMutation({
    mutationFn: (id: string) => client.markRead(id),
    onSuccess: invalidate,
  });

  const rows = signals.data ?? [];
  const unread = rows.filter((s) => !s.read).length;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="text-sm font-medium text-fg">
          {unread} unread{rows.length ? ` of ${rows.length}` : ''}
        </div>
        <Button
          size="sm"
          icon="checks"
          disabled={unread === 0 || markAll.isPending}
          onClick={() => markAll.mutate()}
        >
          Mark all read
        </Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState
          icon="bell"
          title="No signals"
          description="Incoming notifications will appear here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((s) => (
            <li
              key={s.id}
              className={`flex items-start gap-3 px-4 py-3 ${s.read ? 'opacity-60' : ''}`}
            >
              <Badge tone={SEVERITY_TONE[s.severity]} dot>
                {s.severity}
              </Badge>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-fg">{s.title}</div>
                {s.body ? <div className="text-xs text-muted">{s.body}</div> : null}
                <div className="mt-0.5 text-xs text-faint">{relativeTime(s.ts)}</div>
              </div>
              {!s.read ? (
                <button
                  type="button"
                  onClick={() => markOne.mutate(s.id)}
                  className="shrink-0 text-xs text-link hover:underline focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none"
                >
                  Mark read
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function ChannelsTab({ client }: { client: TransmitterClient }) {
  const qc = useQueryClient();
  const toast = useToast();
  const channels = useQuery({ queryKey: ['tx', 'channels'], queryFn: () => client.listChannels() });
  const [editing, setEditing] = useState<Channel | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Channel | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tx', 'channels'] });

  const saveMut = useMutation({
    mutationFn: (vars: {
      id?: string;
      input: Parameters<TransmitterClient['createChannel']>[0];
    }) => (vars.id ? client.updateChannel(vars.id, vars.input) : client.createChannel(vars.input)),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setCreating(false);
      toast.success('Channel saved');
    },
    onError: () => toast.error('Could not save the channel'),
  });
  const delMut = useMutation({
    mutationFn: (id: string) => client.deleteChannel(id),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
      toast.success('Channel deleted');
    },
  });
  const testMut = useMutation({
    mutationFn: (id: string) => client.testChannel(id),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['tx', 'deliveries'] });
      if (d.ok) toast.success(`Test sent to ${d.channelName}`);
      else toast.error(`Test failed: ${d.error}`);
    },
  });

  const rows = channels.data ?? [];

  return (
    <>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-sm font-medium text-fg">{rows.length} channels</div>
          <Button size="sm" icon="plus" variant="primary" onClick={() => setCreating(true)}>
            Add channel
          </Button>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon="paper-plane-tilt"
            title="No channels"
            description="Add Telegram, email, Discord, Slack or a webhook to receive notifications."
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <Icon name={CHANNEL_META[c.kind].icon} size={18} className="shrink-0 text-faint" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-fg">
                    {c.name}
                    {!c.enabled ? <Badge tone="neutral">disabled</Badge> : null}
                  </div>
                  <div className="flex items-center gap-1.5 text-xs text-faint">
                    <Icon name={c.credentialSet ? 'lock-simple' : 'warning'} size={12} />
                    {c.credentialSet
                      ? `Credential set${c.credentialUpdatedAt ? `, updated ${relativeTime(c.credentialUpdatedAt)}` : ''}`
                      : 'No credential'}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="paper-plane-tilt"
                  disabled={testMut.isPending}
                  onClick={() => testMut.mutate(c.id)}
                >
                  Send test
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="pencil-simple"
                  onClick={() => setEditing(c)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() => setDeleting(c)}
                  aria-label={`Delete ${c.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating ? (
        <ChannelEditor
          key="new"
          open
          channel={null}
          busy={saveMut.isPending}
          onClose={() => setCreating(false)}
          onSave={(input) => saveMut.mutate({ input })}
        />
      ) : null}
      {editing ? (
        <ChannelEditor
          key={editing.id}
          open
          channel={editing}
          busy={saveMut.isPending}
          onClose={() => setEditing(null)}
          onSave={(input) => saveMut.mutate({ id: editing.id, input })}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && delMut.mutate(deleting.id)}
        busy={delMut.isPending}
        danger
        title="Delete channel?"
        description={deleting ? `${deleting.name} will be removed from all routes.` : ''}
        confirmLabel="Delete"
      />
    </>
  );
}

function RoutesTab({ client }: { client: TransmitterClient }) {
  const qc = useQueryClient();
  const toast = useToast();
  const routes = useQuery({ queryKey: ['tx', 'routes'], queryFn: () => client.listRoutes() });
  const channels = useQuery({ queryKey: ['tx', 'channels'], queryFn: () => client.listChannels() });
  const [editing, setEditing] = useState<RouteRule | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<RouteRule | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tx', 'routes'] });
  const saveMut = useMutation({
    mutationFn: (vars: { id?: string; input: Parameters<TransmitterClient['createRoute']>[0] }) =>
      vars.id ? client.updateRoute(vars.id, vars.input) : client.createRoute(vars.input),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      setCreating(false);
      toast.success('Route saved');
    },
  });
  const delMut = useMutation({
    mutationFn: (id: string) => client.deleteRoute(id),
    onSuccess: () => {
      invalidate();
      setDeleting(null);
    },
  });
  const muteMut = useMutation({
    mutationFn: (r: RouteRule) => client.updateRoute(r.id, { ...r, muted: !r.muted }),
    onSuccess: invalidate,
  });

  const rows = routes.data ?? [];
  const chans = channels.data ?? [];
  const chanName = (id: string) => chans.find((c) => c.id === id)?.name ?? id;

  return (
    <>
      <Card>
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <div className="text-sm font-medium text-fg">{rows.length} routes</div>
          <Button size="sm" icon="plus" variant="primary" onClick={() => setCreating(true)}>
            Create route
          </Button>
        </div>
        {rows.length === 0 ? (
          <EmptyState
            icon="arrows-split"
            title="No routes"
            description="Routes decide which signals reach which channels."
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium text-fg">
                    {r.name}
                    {r.muted ? (
                      <Badge tone="neutral">
                        <Icon name="bell-slash" size={11} /> muted
                      </Badge>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
                    <span>≥ {r.match.minSeverity}</span>
                    <span>·</span>
                    <span>
                      {r.match.projects.length ? r.match.projects.join(', ') : 'any project'}
                    </span>
                    <span>·</span>
                    <span>→ {r.channelIds.map(chanName).join(', ') || 'no channels'}</span>
                    {r.throttlePerMin ? <span>· ≤{r.throttlePerMin}/min</span> : null}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  icon={r.muted ? 'bell' : 'bell-slash'}
                  onClick={() => muteMut.mutate(r)}
                >
                  {r.muted ? 'Unmute' : 'Mute'}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="pencil-simple"
                  onClick={() => setEditing(r)}
                >
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  onClick={() => setDeleting(r)}
                  aria-label={`Delete ${r.name}`}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {creating ? (
        <RouteEditor
          key="new"
          open
          route={null}
          channels={chans}
          busy={saveMut.isPending}
          onClose={() => setCreating(false)}
          onSave={(input) => saveMut.mutate({ input })}
        />
      ) : null}
      {editing ? (
        <RouteEditor
          key={editing.id}
          open
          route={editing}
          channels={chans}
          busy={saveMut.isPending}
          onClose={() => setEditing(null)}
          onSave={(input) => saveMut.mutate({ id: editing.id, input })}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={() => deleting && delMut.mutate(deleting.id)}
        busy={delMut.isPending}
        danger
        title="Delete route?"
        description={deleting ? `${deleting.name} will stop routing signals.` : ''}
        confirmLabel="Delete"
      />
    </>
  );
}

function SourcesTab({ client }: { client: TransmitterClient }) {
  const qc = useQueryClient();
  const toast = useToast();
  const sources = useQuery({ queryKey: ['tx', 'sources'], queryFn: () => client.listSources() });
  const [newName, setNewName] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['tx', 'sources'] });
  const createMut = useMutation({
    mutationFn: (name: string) => client.createSource({ name }),
    onSuccess: (secret) => {
      invalidate();
      setNewName('');
      setToken(secret.token);
    },
  });
  const rotateMut = useMutation({
    mutationFn: (id: string) => client.rotateToken(id),
    onSuccess: (secret) => {
      invalidate();
      setToken(secret.token);
    },
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => client.revokeSource(id),
    onSuccess: () => {
      invalidate();
      setRevoking(null);
      toast.success('Source revoked');
    },
  });

  const rows = sources.data ?? [];

  return (
    <>
      <Card>
        <form
          className="flex items-center gap-2 border-b border-line px-4 py-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) createMut.mutate(newName.trim());
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New inbound webhook source name…"
            aria-label="New source name"
            className="h-9 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-faint focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none"
          />
          <Button
            type="submit"
            icon="plus"
            variant="primary"
            disabled={!newName.trim() || createMut.isPending}
          >
            Create
          </Button>
        </form>
        {rows.length === 0 ? (
          <EmptyState
            icon="plugs"
            title="No sources"
            description="Inbound webhook sources let external systems push signals in."
          />
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((s) => (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3">
                <Icon
                  name={s.kind === 'builtin' ? 'lightning' : 'webhooks-logo'}
                  size={18}
                  className="shrink-0 text-faint"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-fg">{s.name}</div>
                  <div className="text-xs text-faint">
                    {s.kind === 'builtin'
                      ? 'Built-in · always on'
                      : `Webhook · token …${s.tokenHint ?? '????'} · added ${relativeTime(s.createdAt)}`}
                  </div>
                </div>
                {s.kind === 'webhook' ? (
                  <>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="arrows-clockwise"
                      disabled={rotateMut.isPending}
                      onClick={() => rotateMut.mutate(s.id)}
                    >
                      Rotate
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      icon="trash"
                      onClick={() => setRevoking(s.id)}
                      aria-label={`Revoke ${s.name}`}
                    />
                  </>
                ) : (
                  <Badge tone="ok" dot>
                    active
                  </Badge>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <OneTimeTokenModal open={token !== null} token={token} onClose={() => setToken(null)} />
      <ConfirmDialog
        open={revoking !== null}
        onClose={() => setRevoking(null)}
        onConfirm={() => revoking && revokeMut.mutate(revoking)}
        busy={revokeMut.isPending}
        danger
        title="Revoke source?"
        description="Its token stops working immediately and cannot be recovered."
        confirmLabel="Revoke"
      />
    </>
  );
}

function DeliveriesTab({ client }: { client: TransmitterClient }) {
  const deliveries = useQuery({
    queryKey: ['tx', 'deliveries'],
    queryFn: () => client.listDeliveries(),
  });
  const rows = deliveries.data ?? [];
  return (
    <Card>
      {rows.length === 0 ? (
        <EmptyState
          icon="paper-plane-tilt"
          title="No deliveries yet"
          description="Sent notifications — and their success or failure — will be logged here."
        />
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-4 py-3">
              <Icon
                name={d.ok ? 'check-circle' : 'x-circle'}
                size={18}
                className={`shrink-0 ${d.ok ? 'text-ok' : 'text-danger'}`}
                label={d.ok ? 'Delivered' : 'Failed'}
              />
              <div className="min-w-0 flex-1">
                <div className="text-sm text-fg">{d.signalTitle}</div>
                <div className="text-xs text-faint">
                  {d.channelName}
                  {d.error ? ` · ${d.error}` : ''}
                </div>
              </div>
              <span className="shrink-0 text-xs text-faint">{relativeTime(d.ts)}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
