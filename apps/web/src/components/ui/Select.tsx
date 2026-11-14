import type { SelectHTMLAttributes } from 'react';
import { Icon } from './Icon';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
  invalid?: boolean;
}

/**
 * A native <select> styled to the design. Native is deliberate: it gives correct
 * keyboard handling, typeahead and mobile pickers for free, which a custom
 * listbox would have to re-implement.
 */
export function Select({ options, invalid, className = '', ...rest }: SelectProps) {
  return (
    <div className="relative">
      <select
        aria-invalid={invalid || undefined}
        className={`h-9 w-full appearance-none rounded-lg border border-line bg-surface pr-8 pl-3 text-sm text-fg transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger ${className}`}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Icon
        name="caret-up-down"
        size={14}
        className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-faint"
      />
    </div>
  );
}
