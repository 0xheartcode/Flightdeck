import { useState } from 'react';
import { loginUrl, setToken } from '@/api';
import { Button, Field, Icon, Input } from '@/components/ui';

export interface SignInProps {
  /** Whether the OIDC browser login flow is available. */
  loginFlow: boolean;
}

/**
 * Full-screen sign-in gate, shown when identity is enabled but the caller is not
 * authenticated. Offers the OIDC redirect when available, and a dashboard-token
 * fallback for setups without browser login.
 */
export function SignIn({ loginFlow }: SignInProps) {
  const [token, setTokenInput] = useState('');

  const applyToken = () => {
    if (!token.trim()) return;
    setToken(token.trim());
    // Re-run the initial queries with the new token.
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

        {loginFlow ? (
          <Button
            variant="primary"
            icon="sign-in"
            className="mt-5 w-full"
            onClick={() => (window.location.href = loginUrl())}
          >
            Continue with SSO
          </Button>
        ) : null}

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
            variant={loginFlow ? 'default' : 'primary'}
            disabled={!token.trim()}
          >
            Use token
          </Button>
        </form>
      </div>
    </div>
  );
}
