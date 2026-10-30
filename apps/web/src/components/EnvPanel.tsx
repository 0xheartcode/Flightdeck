import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchServiceDetail } from '@/api';

const MASKED = '********';

interface Props {
  serviceId: string;
}

/**
 * Environment variables for the selected service, fetched from the reveal-gated
 * detail endpoint. Values arrive masked unless the caller has the reveal
 * permission, in which case the control plane sends the real values. Renders
 * nothing when the agent is not collecting env (field absent or empty).
 */
export function EnvPanel({ serviceId }: Props) {
  const [open, setOpen] = useState(true);
  const { data } = useQuery({
    queryKey: ['service', serviceId],
    queryFn: () => fetchServiceDetail(serviceId),
  });

  const env = data?.env;
  if (!env || env.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-slate-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-slate-400 transition-colors hover:text-slate-200"
      >
        <span className="text-slate-600">{open ? '▾' : '▸'}</span>
        Environment
        <span className="tabular-nums text-slate-600">{env.length}</span>
      </button>
      {open && (
        <dl className="max-h-48 overflow-auto bg-[#07090d] px-4 py-3 font-mono text-xs leading-relaxed">
          {env.map((v) => (
            <div key={v.key} className="flex gap-2 whitespace-pre-wrap break-all py-0.5">
              <dt className="shrink-0 text-slate-300">{v.key}</dt>
              <span className="shrink-0 text-slate-600">=</span>
              {v.value === MASKED ? (
                <dd className="flex items-center gap-2 text-slate-500">
                  <span className="tracking-widest">{MASKED}</span>
                  <span className="rounded bg-slate-800 px-1 py-0.5 text-[10px] text-slate-500">
                    masked
                  </span>
                </dd>
              ) : (
                <dd className="text-slate-200">{v.value}</dd>
              )}
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
