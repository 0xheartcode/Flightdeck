import { useEffect, useState } from 'react';
import { fetchAuthMethods, localLogin, loginUrl, setToken, type AuthMethods } from '@/api';
import { Button, Field, Icon, Input } from '@/components/ui';

export interface SignInProps {
  /** Whether the OIDC browser login flow is available (initial hint from /api/me). */
  loginFlow: boolean;
}

/**
 * Full-screen sign-in gate, shown when the control plane requires authentication.
 * It discovers the available methods from the public /auth/methods endpoint, so
 * it can offer local username/password login, the OIDC SSO redirect, and a
 * dashboard-token fallback in whatever combination the server enables.
 */
export function SignIn({ loginFlow }: SignInProps) {
  const [methods, setMethods] = useState<AuthMethods>({
    identityEnabled: true,
    loginFlow,
    localUsers: false,
  });
  useEffect(() => {
    let alive = true;
    fetchAuthMethods()
      .then((m) => alive && setMethods(m))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [token, setTokenInput] = useState('');

  const submitLocal = async () => {
    if (!username.trim() || !password) return;
    setBusy(true);
    setError('');
    try {
      await localLogin(username.trim(), password);
      window.location.reload();
    } catch {
      setError('Incorrect username or password.');
      setBusy(false);
    }
  };

  const applyToken = () => {
    if (!token.trim()) return;
    setToken(token.trim());
    window.location.reload();
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-app px-4">
      <div className="w-full max-w-sm rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow)]">
        <div className="mb-5 flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-[#191b1e]">
            <Icon name="broadcast" size={20} />
          </span>
          <span className="text-base font-semibold tracking-tight text-fg">Flightdeck</span>
        </div>

        <h1 className="text-lg font-semibold text-fg">Sign in</h1>
        <p className="mt-1 text-sm text-muted">This control plane requires authentication.</p>

        {methods.localUsers ? (
          <form
            className="mt-5 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void submitLocal();
            }}
          >
            <Field label="Username">
              {({ id }) => (
                <Input
                  id={id}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="you"
                  autoComplete="username"
                  autoFocus
                />
              )}
            </Field>
            <Field label="Password">
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
              )}
            </Field>
            {error ? (
              <p className="flex items-center gap-1.5 text-xs text-danger">
                <Icon name="warning" size={13} />
                {error}
              </p>
            ) : null}
            <Button
              type="submit"
              variant="primary"
              disabled={busy || !username.trim() || !password}
            >
              {busy ? 'Signing in…' : 'Sign in'}
            </Button>
          </form>
        ) : null}

        {methods.loginFlow ? (
          <Button
            variant={methods.localUsers ? 'default' : 'primary'}
            icon="sign-in"
            className="mt-3 w-full"
            onClick={() => (window.location.href = loginUrl())}
          >
            Continue with SSO
          </Button>
        ) : null}

        {!methods.localUsers ? (
          <form
            className="mt-5 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              applyToken();
            }}
          >
            <Field label="Dashboard token" hint="Paste the token your operator issued.">
              {({ id }) => (
                <Input
                  id={id}
                  type="password"
                  mono
                  value={token}
                  onChange={(e) => setTokenInput(e.target.value)}
                  placeholder="fd_…"
                  autoComplete="off"
                />
              )}
            </Field>
            <Button
              type="submit"
              variant={methods.loginFlow ? 'default' : 'primary'}
              disabled={!token.trim()}
            >
              Use token
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
