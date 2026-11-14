export interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name; required because the switch has no visible text of its own. */
  label: string;
  disabled?: boolean;
  /** Reason shown (and announced) when the switch is disabled. */
  reason?: string;
  id?: string;
}

/**
 * An accessible on/off switch (role="switch"). Keyboard operable (Space/Enter via
 * the native button), with a visible focus ring and both themes.
 */
export function Toggle({ checked, onChange, label, disabled, reason, id }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      title={disabled && reason ? reason : undefined}
      onClick={() => !disabled && onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${
        checked ? 'border-transparent bg-accent' : 'border-line2 bg-sunken'
      }`}
    >
      <span
        aria-hidden
        className={`inline-block h-3.5 w-3.5 transform rounded-full bg-surface shadow-sm transition-transform ${
          checked ? 'translate-x-4.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  );
}
