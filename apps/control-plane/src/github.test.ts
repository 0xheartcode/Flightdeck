import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { deployFromWorkflowRun, verifySignature } from './github.js';

function sign(secret: string, body: string): string {
  return 'sha256=' + createHmac('sha256', secret).update(body).digest('hex');
}

describe('verifySignature', () => {
  it('accepts a correct signature and rejects wrong, missing, or unconfigured', () => {
    const body = '{"a":1}';
    expect(verifySignature('s', body, sign('s', body))).toBe(true);
    expect(verifySignature('s', body, sign('wrong', body))).toBe(false);
    expect(verifySignature('s', body, undefined)).toBe(false);
    expect(verifySignature('', body, sign('s', body))).toBe(false);
  });
});

describe('deployFromWorkflowRun', () => {
  it('maps a completed successful run', () => {
    const d = deployFromWorkflowRun({
      repository: { full_name: 'acme/api' },
      workflow_run: {
        id: 42,
        head_sha: 'abcdef',
        head_branch: 'main',
        status: 'completed',
        conclusion: 'success',
        html_url: 'http://run',
        actor: { login: 'octocat' },
        run_started_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:01:00Z',
      },
    });
    expect(d).toMatchObject({
      id: 'gha-acme/api-42',
      repo: 'acme/api',
      sha: 'abcdef',
      branch: 'main',
      status: 'success',
      actor: 'octocat',
    });
  });

  it('maps failure and in-progress states', () => {
    const base = { repository: { full_name: 'a/b' } };
    expect(
      deployFromWorkflowRun({
        ...base,
        workflow_run: { id: 1, head_sha: 'x', status: 'completed', conclusion: 'failure' },
      })?.status,
    ).toBe('failure');
    expect(
      deployFromWorkflowRun({
        ...base,
        workflow_run: { id: 1, head_sha: 'x', status: 'in_progress', conclusion: null },
      })?.status,
    ).toBe('in_progress');
  });

  it('returns null for an unusable payload', () => {
    expect(deployFromWorkflowRun({})).toBeNull();
    expect(deployFromWorkflowRun({ repository: { full_name: 'a/b' } })).toBeNull();
  });
});
