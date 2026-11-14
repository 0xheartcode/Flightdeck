/**
 * Light/dark theme control. The CSS in index.css defaults to light, flips to
 * dark under prefers-color-scheme, and obeys an explicit `data-theme` attribute
 * on <html>. This module is the only writer of that attribute and persists the
 * choice per browser (localStorage is per-viewer and guarded, so a private
 * window simply falls back to the system preference).
 */
export type Theme = 'light' | 'dark';

const KEY = 'fd_theme';

export function getStoredTheme(): Theme | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : null;
  } catch {
    return null;
  }
}

export function systemTheme(): Theme {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

/** The theme that should be active: an explicit stored choice, else the system. */
export function resolveTheme(): Theme {
  return getStoredTheme() ?? systemTheme();
}

export function applyTheme(theme: Theme): void {
  try {
    document.documentElement.setAttribute('data-theme', theme);
  } catch {
    // No document (SSR/tests without DOM): nothing to apply.
  }
}

export function setTheme(theme: Theme): void {
  applyTheme(theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    // Without storage the choice simply does not persist across reloads.
  }
}

/** Flip the current theme, persist it, and return the new value. */
export function toggleTheme(): Theme {
  const current = (() => {
    try {
      const attr = document.documentElement.getAttribute('data-theme');
      if (attr === 'light' || attr === 'dark') return attr;
    } catch {
      /* fall through */
    }
    return resolveTheme();
  })();
  const next: Theme = current === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

/** Apply the resolved theme on startup. Safe to call before React mounts. */
export function initTheme(): void {
  applyTheme(resolveTheme());
}
