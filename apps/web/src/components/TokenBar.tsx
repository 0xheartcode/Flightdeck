import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { clearToken, setToken } from '@/api';

interface Props {
  /** Whether the control plane has identity enforcement turned on. */
  identityEnabled: boolean;
  /** True when identity is on and the caller is signed in with a valid token. */
  authenticated: boolean;
  /** Display name of the signed-in caller (falls back to the subject). */
  name?: string;
}

/**
 * Header control for runtime authentication. Hidden entirely when identity is
 * disabled. When signed out it offers a token field; when signed in it shows
 * the caller and a sign-out button. Either action refetches every query so the
 * rest of the UI reflects the new permissions.
 */
export function TokenBar({ identityEnabled, authenticated, name }: Props) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState('');

  if (!identityEnabled) {
    return null;
  }

  const signIn = (): void => {
    const token = value.trim();
    if (!token) return;
    setToken(token);
    setValue('');
    void queryClient.invalidateQueries();
  };

  const signOut = (): void => {
    clearToken();
    void queryClient.invalidateQueries();
  };

  if (authenticated) {
    return (
      <div className="flex min-w-0 items-center gap-2 text-xs text-slate-400">
        <span className="min-w-0 truncate">
          Signed in as <span className="text-slate-200">{name}</span>
        </span>
        <button
          type="button"
          onClick={signOut}
          className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
        >
          Sign out
        </button>
      </div>
    );
  }

  return (
    <form
      className="flex min-w-0 items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        signIn();
      }}
    >
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="API token"
        aria-label="API token"
        className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-0.5 text-xs text-slate-200 placeholder:text-slate-600 focus:border-slate-500 focus:outline-none md:w-48 md:flex-none"
      />
      <button
        type="submit"
        className="shrink-0 rounded border border-slate-700 px-2 py-0.5 text-xs text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
      >
        Sign in
      </button>
    </form>
  );
}
