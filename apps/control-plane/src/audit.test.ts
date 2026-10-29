import { describe, expect, it } from 'vitest';
import { AuditLog } from './audit.js';

describe('AuditLog', () => {
  it('returns newest entries first and caps the ring buffer', () => {
    const audit = new AuditLog(2);
    audit.record({ ts: 1, action: 'restart', serviceId: 'a', actor: 'x', ok: true });
    audit.record({ ts: 2, action: 'restart', serviceId: 'b', actor: 'x', ok: true });
    audit.record({
      ts: 3,
      action: 'redeploy',
      serviceId: 'c',
      actor: 'x',
      ok: false,
      error: 'boom',
    });

    const list = audit.list();
    expect(list.map((e) => e.serviceId)).toEqual(['c', 'b']); // newest first, oldest dropped
    expect(list[0]?.error).toBe('boom');
  });

  it('limits the returned list', () => {
    const audit = new AuditLog(10);
    for (let i = 0; i < 5; i++) {
      audit.record({ ts: i, action: 'restart', serviceId: String(i), actor: 'x', ok: true });
    }
    expect(audit.list(2)).toHaveLength(2);
  });
});
