import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DeployRecord, DeployStatus } from '@flightdeck/protocol';

/** Verify a GitHub `X-Hub-Signature-256` header (HMAC-SHA256) in constant time. */
export function verifySignature(
  secret: string,
  body: string,
  signatureHeader: string | undefined,
): boolean {
  if (!secret || !signatureHeader) return false;
  const expected = 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

interface WorkflowRunPayload {
  repository?: { full_name?: string };
  sender?: { login?: string };
  workflow_run?: {
    id?: number;
    head_sha?: string;
    head_branch?: string;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
    actor?: { login?: string };
    run_started_at?: string;
    created_at?: string;
    updated_at?: string;
  };
}

/** Map a GitHub `workflow_run` webhook payload to a DeployRecord, or null. */
export function deployFromWorkflowRun(raw: unknown): DeployRecord | null {
  const payload = raw as WorkflowRunPayload;
  const run = payload.workflow_run;
  const repo = payload.repository?.full_name;
  if (!run || !repo || !run.id || !run.head_sha) return null;

  return {
    id: `gha-${repo}-${run.id}`,
    repo,
    sha: run.head_sha,
    branch: run.head_branch ?? undefined,
    status: mapStatus(run.status, run.conclusion ?? null),
    runUrl: run.html_url ?? undefined,
    actor: run.actor?.login ?? payload.sender?.login ?? undefined,
    startedAt: parseTime(run.run_started_at ?? run.created_at),
    updatedAt: parseTime(run.updated_at),
  };
}

function mapStatus(status: string | undefined, conclusion: string | null): DeployStatus {
  if (status !== 'completed') {
    return status === 'in_progress' ? 'in_progress' : 'pending';
  }
  switch (conclusion) {
    case 'success':
      return 'success';
    case 'cancelled':
      return 'cancelled';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'failure';
    default:
      return 'failure';
  }
}

function parseTime(value: string | undefined): number {
  const t = value ? Date.parse(value) : NaN;
  return Number.isFinite(t) ? t : Date.now();
}
