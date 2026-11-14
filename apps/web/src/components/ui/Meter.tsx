export interface MeterProps {
  /** Current value, 0..max. */
  value: number;
  max?: number;
  /** Accessible name, e.g. "CPU". */
  label: string;
  /** Text shown to the right of the bar, e.g. "42%" or "128 / 512 MB". */
  display?: string;
  /** Fraction (0..1) at which the bar turns amber, then red. */
  warnAt?: number;
  dangerAt?: number;
}

/**
 * A horizontal usage meter (role="meter"). Colour shifts from accent to amber to
 * red as the value crosses the thresholds, so a glance conveys health. When the
 * value is unknown (NaN), the bar renders empty and the display shows the caller's
 * placeholder.
 */
export function Meter({
  value,
  max = 100,
  label,
  display,
  warnAt = 0.75,
  dangerAt = 0.9,
}: MeterProps) {
  const known = Number.isFinite(value) && Number.isFinite(max) && max > 0;
  const frac = known ? Math.min(1, Math.max(0, value / max)) : 0;
  const tone = frac >= dangerAt ? 'bg-danger' : frac >= warnAt ? 'bg-[var(--accent)]' : 'bg-ok';
  return (
    <div className="flex items-center gap-2">
      <div
        role="meter"
        aria-label={label}
        aria-valuenow={known ? Math.round(frac * 100) : undefined}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuetext={display}
        className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--track)]"
      >
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${frac * 100}%` }} />
      </div>
      {display ? (
        <span className="w-16 shrink-0 text-right font-mono text-xs text-muted">{display}</span>
      ) : null}
    </div>
  );
}
