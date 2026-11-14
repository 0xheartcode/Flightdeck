import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { searchLogs } from '@/api';
import { Button, Card, EmptyState, Input, LogViewer } from '@/components/ui';

export interface LogSearchPanelProps {
  serviceId: string;
}

/**
 * Durable log history search over Loki (GET /logs/search). Lives beneath the live
 * tail so operators can jump from "what's happening now" to "find it in history".
 * Only rendered when me.logSearch is true (Loki configured).
 */
export function LogSearchPanel({ serviceId }: LogSearchPanelProps) {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);

  const results = useQuery({
    queryKey: ['logsearch', serviceId, submitted],
    queryFn: () => searchLogs(serviceId, submitted ?? ''),
    enabled: submitted !== null,
  });

  const rows = (results.data ?? []).map((l) => ({ ts: l.ts, stream: l.stream, line: l.line }));

  return (
    <Card>
      <form
        className="flex items-center gap-2 border-b border-line px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(input);
        }}
      >
        <div className="flex-1">
          <Input
            placeholder="Search log history (substring)…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            aria-label="Search log history"
            mono
          />
        </div>
        <Button type="submit" icon="list-magnifying-glass" variant="primary">
          Search
        </Button>
      </form>
      <div className="p-3">
        {submitted === null ? (
          <EmptyState
            icon="list-magnifying-glass"
            title="Search durable history"
            description="Find past log lines across time, beyond the live tail above."
          />
        ) : results.isLoading ? (
          <EmptyState icon="circle-notch" title="Searching…" />
        ) : results.isError ? (
          <EmptyState
            icon="warning-octagon"
            tone="danger"
            title="Search failed"
            description="The log backend is unavailable."
          />
        ) : rows.length === 0 ? (
          <EmptyState
            icon="magnifying-glass"
            title="No matches"
            description={`Nothing found for “${submitted}”.`}
          />
        ) : (
          <LogViewer rows={rows} follow={false} className="max-h-[40vh]" />
        )}
      </div>
    </Card>
  );
}
