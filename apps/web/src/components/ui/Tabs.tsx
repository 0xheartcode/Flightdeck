import { useId, useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';

export interface TabItem {
  id: string;
  label: ReactNode;
  /** Optional trailing count/badge. */
  badge?: ReactNode;
}

export interface TabsProps {
  tabs: TabItem[];
  active: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist. */
  label: string;
}

/**
 * An accessible tab strip (WAI-ARIA tabs pattern). Arrow keys move between tabs,
 * Home/End jump to the ends, and focus follows selection. The caller renders the
 * active panel; this owns only the strip.
 */
export function Tabs({ tabs, active, onChange, label }: TabsProps) {
  const baseId = useId();
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});

  const onKeyDown = (e: KeyboardEvent) => {
    const idx = tabs.findIndex((t) => t.id === active);
    if (idx < 0) return;
    let next: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (idx - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    refs.current[target.id]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={onKeyDown}
      className="flex gap-1 border-b border-line"
    >
      {tabs.map((t) => {
        const selected = t.id === active;
        return (
          <button
            key={t.id}
            ref={(el) => {
              refs.current[t.id] = el;
            }}
            role="tab"
            type="button"
            id={`${baseId}-${t.id}`}
            aria-selected={selected}
            aria-controls={`${baseId}-${t.id}-panel`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
              selected ? 'border-accent text-fg' : 'border-transparent text-muted hover:text-fg'
            }`}
          >
            {t.label}
            {t.badge != null ? <span className="text-xs text-faint">{t.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}

/** Wrapper for a tab panel, wired to its tab by id. */
export function TabPanel({
  id,
  baseId,
  active,
  children,
}: {
  id: string;
  baseId: string;
  active: boolean;
  children: ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-${id}-panel`}
      aria-labelledby={`${baseId}-${id}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
