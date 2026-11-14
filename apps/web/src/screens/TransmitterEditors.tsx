import { useState } from 'react';
import { Button, Drawer, Field, Icon, Input, Modal, Select, Toggle } from '@/components/ui';
import { relativeTime } from '@/lib/format';
import {
  CHANNEL_KINDS,
  CHANNEL_META,
  SEVERITIES,
  type Channel,
  type ChannelInput,
  type ChannelKind,
  type RouteInput,
  type RouteRule,
  type Severity,
} from '@/lib/transmitter/types';

/** Create/edit a channel. Credentials are write-only: on edit we show that one is
 * set and offer Replace, never the value. */
export function ChannelEditor({
  open,
  channel,
  onClose,
  onSave,
  busy,
}: {
  open: boolean;
  channel: Channel | null;
  onClose: () => void;
  onSave: (input: ChannelInput) => void;
  busy: boolean;
}) {
  const [kind, setKind] = useState<ChannelKind>(channel?.kind ?? 'telegram');
  const [name, setName] = useState(channel?.name ?? '');
  const [config, setConfig] = useState<Record<string, string>>(channel?.config ?? {});
  const [enabled, setEnabled] = useState(channel?.enabled ?? true);
  const [credential, setCredential] = useState('');
  const [replacing, setReplacing] = useState(!channel?.credentialSet);

  const meta = CHANNEL_META[kind];

  const save = () => {
    onSave({
      kind,
      name: name.trim(),
      config,
      enabled,
      credential: replacing && credential ? credential : undefined,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={channel ? 'Edit channel' : 'New channel'}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save} disabled={busy || !name.trim()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Type">
          {({ id }) => (
            <Select
              id={id}
              value={kind}
              disabled={Boolean(channel)}
              onChange={(e) => setKind(e.target.value as ChannelKind)}
              options={CHANNEL_KINDS.map((k) => ({ value: k, label: CHANNEL_META[k].label }))}
            />
          )}
        </Field>
        <Field label="Name">
          {({ id }) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`${meta.label} alerts`}
            />
          )}
        </Field>
        {meta.configFields.map((f) => (
          <Field key={f.key} label={f.label}>
            {({ id }) => (
              <Input
                id={id}
                value={config[f.key] ?? ''}
                onChange={(e) => setConfig((c) => ({ ...c, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                mono
              />
            )}
          </Field>
        ))}

        <div className="rounded-lg border border-line bg-raised p-3">
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">{meta.credentialLabel}</span>
            {channel?.credentialSet && !replacing ? (
              <Button size="sm" variant="ghost" onClick={() => setReplacing(true)}>
                Replace
              </Button>
            ) : null}
          </div>
          {channel?.credentialSet && !replacing ? (
            <div className="flex items-center gap-2 text-xs text-muted">
              <Icon name="lock-simple" size={14} className="text-ok" />
              Set
              {channel.credentialUpdatedAt
                ? `, updated ${relativeTime(channel.credentialUpdatedAt)}`
                : ''}
            </div>
          ) : (
            <Input
              type="password"
              value={credential}
              onChange={(e) => setCredential(e.target.value)}
              placeholder="Write-only — never shown after saving"
              mono
              autoComplete="off"
            />
          )}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-fg">Enabled</span>
          <Toggle checked={enabled} onChange={setEnabled} label="Channel enabled" />
        </div>
      </div>
    </Drawer>
  );
}

/** Create/edit a route. */
export function RouteEditor({
  open,
  route,
  channels,
  onClose,
  onSave,
  busy,
}: {
  open: boolean;
  route: RouteRule | null;
  channels: Channel[];
  onClose: () => void;
  onSave: (input: RouteInput) => void;
  busy: boolean;
}) {
  const [name, setName] = useState(route?.name ?? '');
  const [minSeverity, setMinSeverity] = useState<Severity>(route?.match.minSeverity ?? 'warning');
  const [eventTypes, setEventTypes] = useState((route?.match.eventTypes ?? []).join(', '));
  const [projects, setProjects] = useState((route?.match.projects ?? []).join(', '));
  const [channelIds, setChannelIds] = useState<string[]>(route?.channelIds ?? []);
  const [throttle, setThrottle] = useState(
    route?.throttlePerMin ? String(route.throttlePerMin) : '',
  );
  const [muted, setMuted] = useState(route?.muted ?? false);

  const csv = (s: string) =>
    s
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
  const toggleChannel = (id: string) =>
    setChannelIds((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const save = () => {
    onSave({
      name: name.trim(),
      match: { eventTypes: csv(eventTypes), minSeverity, projects: csv(projects) },
      channelIds,
      throttlePerMin: throttle ? Number(throttle) : undefined,
      muted,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={route ? 'Edit route' : 'New route'}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={save}
            disabled={busy || !name.trim() || channelIds.length === 0}
          >
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          {({ id }) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Critical → on-call"
            />
          )}
        </Field>
        <Field label="Minimum severity" hint="Signals at or above this severity match.">
          {({ id }) => (
            <Select
              id={id}
              value={minSeverity}
              onChange={(e) => setMinSeverity(e.target.value as Severity)}
              options={SEVERITIES.map((s) => ({ value: s, label: s }))}
            />
          )}
        </Field>
        <Field label="Event types" hint="Comma-separated; empty matches any.">
          {({ id }) => (
            <Input
              id={id}
              value={eventTypes}
              onChange={(e) => setEventTypes(e.target.value)}
              placeholder="deploy, service.exited"
              mono
            />
          )}
        </Field>
        <Field label="Projects" hint="Comma-separated repos; empty matches any.">
          {({ id }) => (
            <Input
              id={id}
              value={projects}
              onChange={(e) => setProjects(e.target.value)}
              placeholder="acme/web"
              mono
            />
          )}
        </Field>

        <div>
          <div className="mb-1.5 text-xs font-medium text-muted">Channels</div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-line p-2">
            {channels.length === 0 ? (
              <span className="px-1 py-1 text-xs text-faint">
                No channels yet — create one first.
              </span>
            ) : (
              channels.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-row"
                >
                  <input
                    type="checkbox"
                    checked={channelIds.includes(c.id)}
                    onChange={() => toggleChannel(c.id)}
                    className="accent-[var(--accent)]"
                  />
                  <Icon name={CHANNEL_META[c.kind].icon} size={15} className="text-faint" />
                  <span className="text-fg">{c.name}</span>
                </label>
              ))
            )}
          </div>
        </div>

        <Field label="Throttle (per minute)" hint="Blank = unthrottled.">
          {({ id }) => (
            <Input
              id={id}
              type="number"
              min={0}
              value={throttle}
              onChange={(e) => setThrottle(e.target.value)}
              placeholder="10"
            />
          )}
        </Field>

        <div className="flex items-center justify-between">
          <span className="text-sm text-fg">Muted</span>
          <Toggle checked={muted} onChange={setMuted} label="Route muted" />
        </div>
      </div>
    </Drawer>
  );
}

/** Show a one-time webhook token with a copy action and a clear warning. */
export function OneTimeTokenModal({
  open,
  token,
  onClose,
}: {
  open: boolean;
  token: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!token) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Copy this token now"
      description="It is shown once and stored only as a hash. You cannot see it again."
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg border border-line bg-codebg px-3 py-2 font-mono text-xs text-codefg">
          {token}
        </code>
        <Button
          icon={copied ? 'check' : 'copy'}
          onClick={() => {
            navigator.clipboard?.writeText(token).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {},
            );
          }}
        >
          Copy
        </Button>
      </div>
      <p className="mt-3 flex items-start gap-2 text-xs text-warn">
        <Icon name="warning" size={14} className="mt-0.5 shrink-0" />
        Treat it like a password: anyone with it can push signals into Flightdeck as this source.
      </p>
    </Modal>
  );
}
