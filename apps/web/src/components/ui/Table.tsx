import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react';

/** A horizontally scrollable, bordered data table shell. */
export function Table({ children, label }: { children: ReactNode; label: string }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-sm" aria-label={label}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-line text-left">
      <tr>{children}</tr>
    </thead>
  );
}

export function TH({ children, className = '', ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={`px-3 py-2 text-xs font-medium tracking-wide text-faint uppercase ${className}`}
      {...rest}
    >
      {children}
    </th>
  );
}

export function TBody({ children }: { children: ReactNode }) {
  return <tbody>{children}</tbody>;
}

export interface TRProps {
  children: ReactNode;
  /** Make the row activatable (adds hover, pointer, and keyboard support). */
  onClick?: () => void;
  selected?: boolean;
}

export function TR({ children, onClick, selected }: TRProps) {
  if (onClick) {
    return (
      <tr
        onClick={onClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onClick();
          }
        }}
        tabIndex={0}
        aria-selected={selected || undefined}
        className={`cursor-pointer border-b border-line/60 transition-colors hover:bg-row focus-visible:bg-row focus-visible:outline-none ${
          selected ? 'bg-row' : ''
        }`}
      >
        {children}
      </tr>
    );
  }
  return <tr className="border-b border-line/60">{children}</tr>;
}

export function TD({ children, className = '', ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td className={`px-3 py-2.5 align-middle text-fg ${className}`} {...rest}>
      {children}
    </td>
  );
}
