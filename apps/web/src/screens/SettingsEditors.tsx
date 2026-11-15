import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createAgentToken,
  createUser,
  deleteAgentToken,
  deleteUser,
  listAgentTokens,
  listUsers,
  revokeAgentToken,
  rotateAgentToken,
  setUserPassword,
  updateUser,
  type AgentToken,
  type Role,
  type User,
} from '@/api';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Drawer,
  EmptyState,
  Field,
  Icon,
  Input,
  Modal,
  Select,
  Table,
  TBody,
  TD,
  TH,
  THead,
  Toggle,
  TR,
  useToast,
} from '@/components/ui';
import { relativeTime } from '@/lib/format';

const ROLE_OPTIONS: { value: Role; label: string }[] = [
  { value: 'viewer', label: 'Viewer — read-only' },
  { value: 'operator', label: 'Operator — can restart & redeploy' },
  { value: 'admin', label: 'Admin — full access & user management' },
];

const ROLE_TONE: Record<Role, 'neutral' | 'info' | 'accent'> = {
  viewer: 'neutral',
  operator: 'info',
  admin: 'accent',
};

/** The single effective role (highest tier), for display and the editor. */
function primaryRole(roles: Role[]): Role {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('operator')) return 'operator';
  return 'viewer';
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

/** Create/edit a local user. Password is write-only: set on create, or reset. */
function UserEditor({
  open,
  user,
  onClose,
  onCreate,
  onSave,
  busy,
}: {
  open: boolean;
  user: User | null;
  onClose: () => void;
  onCreate: (input: { username: string; password: string; roles: Role[] }) => void;
  onSave: (patch: { roles: Role[]; disabled: boolean; password?: string }) => void;
  busy: boolean;
}) {
  const editing = Boolean(user);
  const [username, setUsername] = useState(user?.username ?? '');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>(user ? primaryRole(user.roles) : 'viewer');
  const [disabled, setDisabled] = useState(user?.disabled ?? false);

  const submit = () => {
    if (editing) {
      onSave({ roles: [role], disabled, password: password || undefined });
    } else {
      onCreate({ username: username.trim(), password, roles: [role] });
    }
  };

  const valid = editing
    ? !password || password.length >= 10
    : username.trim().length > 0 && password.length >= 10;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={editing ? `Edit ${user?.username}` : 'New user'}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} disabled={busy || !valid}>
            {busy ? 'Saving…' : editing ? 'Save' : 'Create user'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Username">
          {({ id }) => (
            <Input
              id={id}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="jonas"
              disabled={editing}
              autoComplete="off"
            />
          )}
        </Field>
        <Field
          label={editing ? 'New password' : 'Password'}
          hint={editing ? 'Leave blank to keep the current password.' : 'At least 10 characters.'}
        >
          {({ id }) => (
            <Input
              id={id}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={editing ? '••••••••' : 'At least 10 characters'}
              autoComplete="new-password"
            />
          )}
        </Field>
        <Field label="Role">
          {({ id }) => (
            <Select
              id={id}
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              options={ROLE_OPTIONS}
            />
          )}
        </Field>
        {editing ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-fg">Disabled</div>
              <div className="text-xs text-faint">A disabled user cannot sign in.</div>
            </div>
            <Toggle checked={disabled} onChange={setDisabled} label="User disabled" />
          </div>
        ) : null}
      </div>
    </Drawer>
  );
}

export function UsersPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const usersQ = useQuery({ queryKey: ['users'], queryFn: listUsers });
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<User | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['users'] });

  const createM = useMutation({
    mutationFn: createUser,
    onSuccess: () => {
      toast.success('User created');
      setEditorOpen(false);
      invalidate();
    },
    onError: () => toast.error('Could not create user (name taken?)'),
  });

  const saveM = useMutation({
    mutationFn: async (args: {
      id: string;
      patch: { roles: Role[]; disabled: boolean; password?: string };
    }) => {
      await updateUser(args.id, { roles: args.patch.roles, disabled: args.patch.disabled });
      if (args.patch.password) await setUserPassword(args.id, args.patch.password);
    },
    onSuccess: () => {
      toast.success('User updated');
      setEditorOpen(false);
      invalidate();
    },
    onError: () => toast.error('Could not update this user'),
  });

  const deleteM = useMutation({
    mutationFn: deleteUser,
    onSuccess: () => {
      toast.success('User removed');
      setConfirmDelete(null);
      invalidate();
    },
    onError: () => {
      toast.error('Could not remove user (last admin?)');
      setConfirmDelete(null);
    },
  });

  const users = usersQ.data ?? [];
  const busy = createM.isPending || saveM.isPending;

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-medium text-fg">Users</div>
          <div className="text-xs text-faint">Local accounts that can sign in to Flightdeck.</div>
        </div>
        <Button
          variant="primary"
          size="sm"
          icon="plus"
          onClick={() => {
            setEditing(null);
            setEditorOpen(true);
          }}
        >
          New user
        </Button>
      </div>

      {users.length === 0 ? (
        <EmptyState
          icon="shield-check"
          title={usersQ.isLoading ? 'Loading users…' : 'No users yet'}
          description="Create the first account to let someone sign in."
        />
      ) : (
        <Table label="Users">
          <THead>
            <TH>User</TH>
            <TH>Role</TH>
            <TH>Status</TH>
            <TH>Last sign-in</TH>
            <TH className="text-right">Actions</TH>
          </THead>
          <TBody>
            {users.map((u) => (
              <TR key={u.id}>
                <TD className="font-medium text-fg">{u.username}</TD>
                <TD>
                  <Badge tone={ROLE_TONE[primaryRole(u.roles)]}>{primaryRole(u.roles)}</Badge>
                </TD>
                <TD>
                  {u.disabled ? (
                    <Badge tone="danger" dot>
                      disabled
                    </Badge>
                  ) : (
                    <Badge tone="ok" dot>
                      active
                    </Badge>
                  )}
                </TD>
                <TD className="text-xs text-faint">
                  {u.lastLoginAt ? relativeTime(u.lastLoginAt) : 'never'}
                </TD>
                <TD className="text-right whitespace-nowrap">
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="pencil-simple"
                    onClick={() => {
                      setEditing(u);
                      setEditorOpen(true);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    onClick={() => setConfirmDelete(u)}
                  >
                    Remove
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <UserEditor
        key={editing?.id ?? 'new'}
        open={editorOpen}
        user={editing}
        busy={busy}
        onClose={() => setEditorOpen(false)}
        onCreate={(input) => createM.mutate(input)}
        onSave={(patch) => editing && saveM.mutate({ id: editing.id, patch })}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        busy={deleteM.isPending}
        danger
        title={`Remove ${confirmDelete?.username}?`}
        description="They will no longer be able to sign in. This cannot be undone."
        confirmLabel="Remove"
        onConfirm={() => confirmDelete && deleteM.mutate(confirmDelete.id)}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Agent tokens
// ---------------------------------------------------------------------------

/** One-time secret reveal, shown once after issuing or rotating a token. */
function SecretModal({
  open,
  secret,
  onClose,
}: {
  open: boolean;
  secret: string | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  if (!secret) return null;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Copy this agent token now"
      description="It is shown once and stored only as a hash. Give it to the agent as FD_AGENT_TOKEN."
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex items-center gap-2">
        <code className="flex-1 overflow-x-auto rounded-lg border border-line bg-codebg px-3 py-2 font-mono text-xs text-codefg">
          {secret}
        </code>
        <Button
          icon={copied ? 'check' : 'copy'}
          onClick={() => {
            navigator.clipboard?.writeText(secret).then(
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
        Treat it like a password: anyone with it can connect an agent as this identity.
      </p>
    </Modal>
  );
}

function tokenStatus(t: AgentToken) {
  if (t.revokedAt)
    return (
      <Badge tone="danger" dot>
        revoked
      </Badge>
    );
  if (t.lastSeenAt)
    return (
      <Badge tone="ok" dot>
        active
      </Badge>
    );
  return (
    <Badge tone="neutral" dot>
      never used
    </Badge>
  );
}

export function AgentTokensPanel() {
  const qc = useQueryClient();
  const toast = useToast();
  const tokensQ = useQuery({ queryKey: ['agent-tokens'], queryFn: listAgentTokens });
  const [issueOpen, setIssueOpen] = useState(false);
  const [name, setName] = useState('');
  const [secret, setSecret] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState<AgentToken | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AgentToken | null>(null);
  const [confirmRotate, setConfirmRotate] = useState<AgentToken | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['agent-tokens'] });

  const issueM = useMutation({
    mutationFn: createAgentToken,
    onSuccess: (res) => {
      setIssueOpen(false);
      setName('');
      setSecret(res.secret);
      invalidate();
    },
    onError: () => toast.error('Could not issue token (invalid name?)'),
  });
  const rotateM = useMutation({
    mutationFn: rotateAgentToken,
    onSuccess: (res) => {
      setConfirmRotate(null);
      setSecret(res.secret);
      invalidate();
    },
    onError: () => {
      toast.error('Could not rotate token');
      setConfirmRotate(null);
    },
  });
  const revokeM = useMutation({
    mutationFn: revokeAgentToken,
    onSuccess: () => {
      toast.success('Token revoked');
      setConfirmRevoke(null);
      invalidate();
    },
    onError: () => {
      toast.error('Could not revoke token');
      setConfirmRevoke(null);
    },
  });
  const deleteM = useMutation({
    mutationFn: deleteAgentToken,
    onSuccess: () => {
      toast.success('Token deleted');
      setConfirmDelete(null);
      invalidate();
    },
    onError: () => {
      toast.error('Could not delete token');
      setConfirmDelete(null);
    },
  });

  const tokens = tokensQ.data ?? [];

  return (
    <Card>
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div>
          <div className="text-sm font-medium text-fg">Agent tokens</div>
          <div className="text-xs text-faint">
            Credentials each host agent uses to connect. Issued once, stored hashed.
          </div>
        </div>
        <Button variant="primary" size="sm" icon="plus" onClick={() => setIssueOpen(true)}>
          Issue token
        </Button>
      </div>

      {tokens.length === 0 ? (
        <EmptyState
          icon="key"
          title={tokensQ.isLoading ? 'Loading tokens…' : 'No agent tokens yet'}
          description="Issue a token and give it to an agent as FD_AGENT_TOKEN."
        />
      ) : (
        <Table label="Agent tokens">
          <THead>
            <TH>Agent</TH>
            <TH>Token</TH>
            <TH>Status</TH>
            <TH>Last seen</TH>
            <TH className="text-right">Actions</TH>
          </THead>
          <TBody>
            {tokens.map((t) => (
              <TR key={t.id}>
                <TD className="font-medium text-fg">{t.name}</TD>
                <TD className="font-mono text-xs text-faint">…{t.hint}</TD>
                <TD>{tokenStatus(t)}</TD>
                <TD className="text-xs text-faint">
                  {t.lastSeenAt ? relativeTime(t.lastSeenAt) : 'never'}
                </TD>
                <TD className="text-right whitespace-nowrap">
                  {t.revokedAt ? null : (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="arrow-clockwise"
                        onClick={() => setConfirmRotate(t)}
                      >
                        Rotate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        icon="prohibit"
                        onClick={() => setConfirmRevoke(t)}
                      >
                        Revoke
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    icon="trash"
                    onClick={() => setConfirmDelete(t)}
                  >
                    Delete
                  </Button>
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Modal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        title="Issue an agent token"
        description="Name the agent this credential identifies; it appears in logs and the audit trail."
        footer={
          <>
            <Button variant="ghost" onClick={() => setIssueOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={!name.trim() || issueM.isPending}
              onClick={() => issueM.mutate(name.trim())}
            >
              {issueM.isPending ? 'Issuing…' : 'Issue token'}
            </Button>
          </>
        }
      >
        <Field label="Agent name" hint="Letters, digits, dot, underscore or hyphen.">
          {({ id }) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="vega"
              mono
              autoFocus
            />
          )}
        </Field>
      </Modal>

      <SecretModal open={secret !== null} secret={secret} onClose={() => setSecret(null)} />

      <ConfirmDialog
        open={confirmRotate !== null}
        onClose={() => setConfirmRotate(null)}
        busy={rotateM.isPending}
        title={`Rotate ${confirmRotate?.name}'s token?`}
        description="The current token stops working immediately; the agent must be updated with the new one."
        confirmLabel="Rotate"
        onConfirm={() => confirmRotate && rotateM.mutate(confirmRotate.id)}
      />
      <ConfirmDialog
        open={confirmRevoke !== null}
        onClose={() => setConfirmRevoke(null)}
        busy={revokeM.isPending}
        danger
        title={`Revoke ${confirmRevoke?.name}'s token?`}
        description="The agent is disconnected and can no longer authenticate. You can delete the row afterwards."
        confirmLabel="Revoke"
        onConfirm={() => confirmRevoke && revokeM.mutate(confirmRevoke.id)}
      />
      <ConfirmDialog
        open={confirmDelete !== null}
        onClose={() => setConfirmDelete(null)}
        busy={deleteM.isPending}
        danger
        title={`Delete ${confirmDelete?.name}'s token?`}
        description="The row is removed entirely. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => confirmDelete && deleteM.mutate(confirmDelete.id)}
      />
    </Card>
  );
}
