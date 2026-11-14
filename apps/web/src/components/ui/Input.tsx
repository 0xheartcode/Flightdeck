import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes } from 'react';

const BASE =
  'w-full rounded-lg border border-line bg-surface px-3 text-sm text-fg placeholder:text-faint transition-colors focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger';

/** A label + control + optional hint/error, wired together for assistive tech. */
export interface FieldProps {
  label: string;
  hint?: ReactNode;
  error?: ReactNode;
  /** Visually hide the label but keep it for screen readers. */
  labelHidden?: boolean;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

export function Field({ label, hint, error, labelHidden, children }: FieldProps) {
  const id = useId();
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className={labelHidden ? 'sr-only' : 'text-xs font-medium text-muted'}>
        {label}
      </label>
      {children({ id, describedBy, invalid: Boolean(error) })}
      {error ? (
        <p id={hintId} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Input({ invalid, mono, className = '', ...rest }: InputProps) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={`${BASE} h-9 ${mono ? 'font-mono' : ''} ${className}`}
      {...rest}
    />
  );
}

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
  mono?: boolean;
}

export function Textarea({ invalid, mono, className = '', rows = 4, ...rest }: TextareaProps) {
  return (
    <textarea
      rows={rows}
      aria-invalid={invalid || undefined}
      className={`${BASE} resize-y py-2 ${mono ? 'font-mono' : ''} ${className}`}
      {...rest}
    />
  );
}
