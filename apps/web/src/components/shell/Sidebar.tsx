import { Icon, type IconName } from '@/components/ui';
import { Button } from '@/components/ui';
import { hrefFor, type Route } from '@/lib/router';

interface NavDef {
  name: Extract<
    Route,
    { name: 'overview' | 'deploys' | 'activity' | 'transmitter' | 'hosts' | 'settings' }
  >['name'];
  label: string;
  icon: IconName;
}

const NAV: NavDef[] = [
  { name: 'overview', label: 'Overview', icon: 'squares-four' },
  { name: 'deploys', label: 'Deploys', icon: 'rocket-launch' },
  { name: 'activity', label: 'Activity', icon: 'clock-counter-clockwise' },
  { name: 'transmitter', label: 'Transmitter', icon: 'broadcast' },
  { name: 'hosts', label: 'Hosts', icon: 'hard-drives' },
  { name: 'settings', label: 'Settings', icon: 'gear-six' },
];

export interface SidebarProps {
  active: Route['name'];
  badges?: Partial<Record<NavDef['name'], string>>;
  onConnectAgent: () => void;
}

export function Sidebar({ active, badges, onConnectAgent }: SidebarProps) {
  return (
    <nav
      aria-label="Primary"
      className="flex h-full w-56 shrink-0 flex-col border-r border-line bg-surface"
    >
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-[#191b1e]">
          <Icon name="broadcast" size={18} />
        </span>
        <span className="text-sm font-semibold tracking-tight text-fg">Flightdeck</span>
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 px-2">
        {NAV.map((item) => {
          const current = active === item.name;
          const badge = badges?.[item.name];
          return (
            <li key={item.name}>
              <a
                href={hrefFor({ name: item.name } as Route)}
                aria-current={current ? 'page' : undefined}
                className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none ${
                  current ? 'bg-[var(--navon)] text-fg' : 'text-muted hover:bg-row hover:text-fg'
                }`}
              >
                <Icon name={item.icon} size={18} className="shrink-0" />
                <span className="flex-1">{item.label}</span>
                {badge ? (
                  <span className="rounded-full bg-sunken px-1.5 py-0.5 text-xs font-medium text-muted tabular-nums">
                    {badge}
                  </span>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
      <div className="p-2">
        <Button
          variant="default"
          icon="plugs-connected"
          className="w-full"
          onClick={onConnectAgent}
        >
          Connect agent
        </Button>
      </div>
    </nav>
  );
}
