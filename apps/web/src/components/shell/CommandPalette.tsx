import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ServiceInfo } from '@flightdeck/protocol';
import { Icon, type IconName } from '@/components/ui';
import { useBodyScrollLock } from '@/components/ui';
import { NAV_NAMES, type Route } from '@/lib/router';

interface PaletteItem {
  key: string;
  label: string;
  hint?: string;
  icon: IconName;
  route: Route;
}

const NAV_ICON: Record<(typeof NAV_NAMES)[number], IconName> = {
  overview: 'squares-four',
  deploys: 'rocket-launch',
  activity: 'clock-counter-clockwise',
  transmitter: 'broadcast',
  hosts: 'hard-drives',
  settings: 'gear-six',
};

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  services: ServiceInfo[];
  onNavigate: (route: Route) => void;
}

/**
 * A ⌘K command palette: a combobox over an in-memory list of destinations (the
 * six screens) and every known service. Arrow keys move the active option,
 * Enter selects, Escape closes. Uses aria-activedescendant so the input keeps
 * focus while the listbox selection moves.
 */
export function CommandPalette({ open, onClose, services, onNavigate }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  useBodyScrollLock(open);

  const items = useMemo<PaletteItem[]>(() => {
    const nav: PaletteItem[] = NAV_NAMES.map((name) => ({
      key: `nav:${name}`,
      label: name.charAt(0).toUpperCase() + name.slice(1),
      hint: 'Go to',
      icon: NAV_ICON[name],
      route: { name } as Route,
    }));
    const svc: PaletteItem[] = services.map((s) => ({
      key: `svc:${s.id}`,
      label: s.name,
      hint: s.host,
      icon: 'cube',
      route: { name: 'service', id: s.id },
    }));
    // Projects (distinct repos) are real jump targets — the design's "map".
    const repos = [...new Set(services.map((s) => s.repo).filter((r): r is string => Boolean(r)))];
    const proj: PaletteItem[] = repos.map((repo) => ({
      key: `proj:${repo}`,
      label: repo,
      hint: 'Project',
      icon: 'folder-simple',
      route: { name: 'project', repo },
    }));
    const q = query.trim().toLowerCase();
    const all = [...nav, ...proj, ...svc];
    if (!q) return all;
    return all.filter(
      (i) => i.label.toLowerCase().includes(q) || i.hint?.toLowerCase().includes(q),
    );
  }, [services, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      // Focus after the portal mounts.
      const t = setTimeout(() => inputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [open]);

  useEffect(() => {
    setActive(0);
  }, [query]);

  if (!open) return null;

  const choose = (item: PaletteItem | undefined) => {
    if (!item) return;
    onNavigate(item.route);
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(items[active]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[12vh]">
      <div
        aria-hidden
        onClick={onClose}
        className="absolute inset-0 bg-[var(--overlay)] motion-safe:animate-[fadein_120ms_ease-out]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="relative w-full max-w-lg overflow-hidden rounded-xl border border-line bg-surface shadow-[var(--pop)] motion-safe:animate-[zoomin_140ms_ease-out]"
      >
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Icon name="magnifying-glass" size={16} className="text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-listbox"
            aria-activedescendant={items[active] ? `palette-opt-${active}` : undefined}
            placeholder="Search services, go to…"
            className="h-12 w-full bg-transparent text-sm text-fg placeholder:text-faint focus:outline-none"
          />
        </div>
        <ul id="palette-listbox" role="listbox" className="max-h-80 overflow-y-auto py-1">
          {items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-faint">No matches</li>
          ) : (
            items.map((item, i) => (
              <li
                key={item.key}
                id={`palette-opt-${i}`}
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(item)}
                className={`flex cursor-pointer items-center gap-2.5 px-3 py-2 text-sm ${
                  i === active ? 'bg-[var(--navon)] text-fg' : 'text-muted'
                }`}
              >
                <Icon name={item.icon} size={16} className="shrink-0 text-faint" />
                <span className="flex-1 text-fg">{item.label}</span>
                {item.hint ? <span className="text-xs text-faint">{item.hint}</span> : null}
              </li>
            ))
          )}
        </ul>
      </div>
    </div>,
    document.body,
  );
}
