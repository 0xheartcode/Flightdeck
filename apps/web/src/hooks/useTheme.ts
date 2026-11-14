import { useCallback, useEffect, useState } from 'react';
import { resolveTheme, setTheme as persist, type Theme } from '@/lib/theme';

/**
 * Track and toggle the active light/dark theme. Initialises from the resolved
 * theme (stored choice, else system) and keeps in sync with the OS preference
 * while no explicit choice has been stored.
 */
export function useTheme(): { theme: Theme; toggle: () => void; set: (t: Theme) => void } {
  const [theme, setThemeState] = useState<Theme>(() => resolveTheme());

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setThemeState(resolveTheme());
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const set = useCallback((t: Theme) => {
    persist(t);
    setThemeState(t);
  }, []);

  const toggle = useCallback(() => {
    setThemeState((cur) => {
      const next: Theme = cur === 'dark' ? 'light' : 'dark';
      persist(next);
      return next;
    });
  }, []);

  return { theme, toggle, set };
}
