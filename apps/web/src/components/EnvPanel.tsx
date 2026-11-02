import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { EnvVar } from '@flightdeck/protocol';
import { fetchServiceDetail } from '@/api';
import type { ActionResult } from '@/hooks/useLogStream';

const MASKED = '********';

interface Props {
  serviceId: string;
  /** Whether the caller may edit the environment (reveal/admin). Read-only when false. */
  canEdit?: boolean;
  /** Replace the service environment with the given variables. */
  onSave?: (env: EnvVar[]) => void;
  /** Result of the last stream action, surfaced here for set_env. */
  actionResult?: ActionResult | null;
  /** Whether an action is currently in flight. */
  actionPending?: boolean;
}

/**
 * Environment variables for the selected service, fetched from the reveal-gated
 * detail endpoint. Values arrive masked unless the caller has the reveal
 * permission, in which case the control plane sends the real values. Renders
 * nothing when the agent is not collecting env (field absent or empty).
 *
 * Admins (reveal) can switch to an edit mode: values start from the real
 * (unmasked) env, and saving replaces the whole set and recreates the
 * container. On a successful save the detail is refetched so the panel reflects
 * the applied env.
 */
export function EnvPanel({
  serviceId,
  canEdit = false,
  onSave,
  actionResult = null,
  actionPending = false,
}: Props) {
  const [open, setOpen] = useState(true);
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<EnvVar[]>([]);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['service', serviceId],
    queryFn: () => fetchServiceDetail(serviceId),
  });

  const env = data?.env;

  // Resolve a save: a successful set_env refetches the detail and leaves edit
  // mode; a failure keeps the draft so the operator can retry.
  useEffect(() => {
    if (!saving || !actionResult || actionResult.action !== 'set_env') {
      return;
    }
    setSaving(false);
    if (actionResult.ok) {
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['service', serviceId] });
    }
  }, [saving, actionResult, queryClient, serviceId]);

  // Dropping the selection resets any in-progress edit.
  useEffect(() => {
    setEditing(false);
    setSaving(false);
  }, [serviceId]);

  if (!env || env.length === 0) {
    return null;
  }

  const startEdit = (): void => {
    setRows(env.map((v) => ({ key: v.key, value: v.value })));
    setEditing(true);
  };

  const cancelEdit = (): void => {
    setEditing(false);
    setSaving(false);
  };

  const updateRow = (index: number, patch: Partial<EnvVar>): void => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number): void => {
    setRows((prev) => prev.filter((_, i) => i !== index));
  };

  const addRow = (): void => {
    setRows((prev) => [...prev, { key: '', value: '' }]);
  };

  const save = (): void => {
    if (!onSave) return;
    setSaving(true);
    onSave(rows.filter((row) => row.key.trim() !== ''));
  };

  const setEnvResult = actionResult?.action === 'set_env' ? actionResult : null;

  return (
    <section className="border-b border-slate-800">
      <div className="flex w-full items-center gap-2 px-4 py-2 text-xs font-medium text-slate-400">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-2 transition-colors hover:text-slate-200"
        >
          <span className="text-slate-600">{open ? '▾' : '▸'}</span>
          Environment
          <span className="tabular-nums text-slate-600">{env.length}</span>
        </button>
        {setEnvResult && (
          <span className={setEnvResult.ok ? 'text-emerald-400' : 'text-rose-400'}>
            {setEnvResult.ok ? 'env saved' : `env save failed: ${setEnvResult.error ?? 'error'}`}
          </span>
        )}
        {canEdit && open && (
          <span className="ml-auto flex items-center gap-2">
            {editing ? (
              <>
                <button
                  type="button"
                  onClick={save}
                  disabled={saving || actionPending}
                  className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={startEdit}
                className="rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
              >
                Edit
              </button>
            )}
          </span>
        )}
      </div>
      {open &&
        (editing ? (
          <div className="max-h-48 overflow-auto bg-[#07090d] px-4 py-3 font-mono text-xs leading-relaxed">
            {rows.map((row, i) => (
              <div key={i} className="flex items-center gap-2 py-0.5">
                <input
                  value={row.key}
                  onChange={(e) => updateRow(i, { key: e.target.value })}
                  placeholder="KEY"
                  spellCheck={false}
                  className="w-40 shrink-0 rounded border border-slate-700 bg-[#0b0e14] px-1.5 py-0.5 text-slate-200 focus:border-slate-500 focus:outline-none"
                />
                <span className="shrink-0 text-slate-600">=</span>
                <input
                  value={row.value}
                  onChange={(e) => updateRow(i, { value: e.target.value })}
                  placeholder="value"
                  spellCheck={false}
                  className="min-w-0 flex-1 rounded border border-slate-700 bg-[#0b0e14] px-1.5 py-0.5 text-slate-200 focus:border-slate-500 focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeRow(i)}
                  aria-label={`Remove ${row.key || 'variable'}`}
                  className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-slate-400 transition-colors hover:border-rose-500 hover:text-rose-300"
                >
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={addRow}
              className="mt-1 rounded border border-slate-700 px-2 py-0.5 text-slate-300 transition-colors hover:border-slate-500 hover:text-slate-100"
            >
              + Add variable
            </button>
          </div>
        ) : (
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
        ))}
    </section>
  );
}
