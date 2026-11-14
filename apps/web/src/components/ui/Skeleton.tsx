export interface SkeletonProps {
  className?: string;
  /** Rounded shape for avatar/badge placeholders. */
  circle?: boolean;
}

/**
 * A loading placeholder. The pulse is disabled automatically under
 * prefers-reduced-motion (handled globally in index.css). Marked aria-hidden; the
 * surrounding region should carry aria-busy.
 */
export function Skeleton({ className = 'h-4 w-full', circle }: SkeletonProps) {
  return (
    <span
      aria-hidden
      className={`block animate-pulse bg-[var(--track)] ${circle ? 'rounded-full' : 'rounded-md'} ${className}`}
    />
  );
}

/** A few stacked skeleton lines for text blocks. */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-3.5 ${i === lines - 1 ? 'w-2/3' : 'w-full'}`} />
      ))}
    </div>
  );
}
