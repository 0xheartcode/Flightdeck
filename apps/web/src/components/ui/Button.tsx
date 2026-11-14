import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

type Variant = 'primary' | 'default' | 'ghost' | 'danger';
type Size = 'sm' | 'md';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-[#191b1e] border-transparent hover:bg-accent-hover',
  default: 'bg-surface text-fg border-line hover:border-line2',
  ghost: 'bg-transparent text-muted border-transparent hover:bg-row hover:text-fg',
  danger: 'bg-transparent text-danger border-line hover:border-danger',
};

const SIZES: Record<Size, string> = {
  sm: 'h-7 gap-1 px-2 text-xs',
  md: 'h-9 gap-1.5 px-3 text-sm',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  icon?: IconName;
  /** Shown as a tooltip when the button is disabled (e.g. a missing permission). */
  reason?: string;
  children?: ReactNode;
}

export function Button({
  variant = 'default',
  size = 'md',
  icon,
  reason,
  disabled,
  children,
  className = '',
  title,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-disabled={disabled || undefined}
      title={disabled && reason ? reason : title}
      className={`inline-flex items-center justify-center rounded-lg border font-medium transition-colors focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${SIZES[size]} ${className}`}
      {...rest}
    >
      {icon ? <Icon name={icon} size={size === 'sm' ? 14 : 16} /> : null}
      {children}
    </button>
  );
}
