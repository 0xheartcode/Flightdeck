import { describe, expect, it } from 'vitest';
import { permissionsFrom } from './permissions';
import type { Me } from '@/api';

const me = (over: Partial<Me>): Me => ({
  identityEnabled: true,
  loginFlow: false,
  logSearch: false,
  roles: [],
  permissions: [],
  ...over,
});

describe('permissionsFrom', () => {
  it('grants everything when identity is off (legacy mode)', () => {
    const p = permissionsFrom(me({ identityEnabled: false }));
    expect(p.has('act')).toBe(true);
    expect(p.has('reveal')).toBe(true);
    expect(p.can('restart').enabled).toBe(true);
    expect(p.can('edit_env').enabled).toBe(true);
    expect(p.authenticated).toBe(true);
  });

  it('read-only user: act and reveal controls are visible but disabled with a reason', () => {
    const p = permissionsFrom(me({ permissions: ['view'], subject: 'u1' }));
    expect(p.has('view')).toBe(true);
    expect(p.has('act')).toBe(false);
    const restart = p.can('restart');
    expect(restart.visible).toBe(true);
    expect(restart.enabled).toBe(false);
    expect(restart.reason).toMatch(/operator/i);
    expect(p.can('reveal_env').reason).toMatch(/admin/i);
  });

  it('operator can act but not reveal/edit env', () => {
    const p = permissionsFrom(me({ permissions: ['view', 'act'], subject: 'u1' }));
    expect(p.can('restart').enabled).toBe(true);
    expect(p.can('redeploy').enabled).toBe(true);
    expect(p.can('reveal_env').enabled).toBe(false);
    expect(p.can('edit_env').enabled).toBe(false);
  });

  it('admin can act and reveal/edit', () => {
    const p = permissionsFrom(me({ permissions: ['view', 'act', 'reveal'], subject: 'u1' }));
    expect(p.can('restart').enabled).toBe(true);
    expect(p.can('reveal_env').enabled).toBe(true);
    expect(p.can('edit_env').enabled).toBe(true);
  });

  it('treats a 401 as identity-on-but-unauthenticated', () => {
    const p = permissionsFrom(undefined, true);
    expect(p.identityEnabled).toBe(true);
    expect(p.authenticated).toBe(false);
    expect(p.has('act')).toBe(false);
  });

  it('server-wide actions switch disables mutating controls with a reason', () => {
    const p = permissionsFrom(
      me({ permissions: ['view', 'act', 'reveal'], subject: 'u1', actionsEnabled: false }),
    );
    // Even an admin cannot act while the server switch is off.
    expect(p.actionsEnabled).toBe(false);
    expect(p.can('restart').enabled).toBe(false);
    expect(p.can('restart').reason).toMatch(/disabled on this server/i);
    expect(p.can('edit_env').enabled).toBe(false);
    // Revealing env is a read, so it stays enabled for an admin.
    expect(p.can('reveal_env').enabled).toBe(true);
  });

  it('defaults actionsEnabled to true when the field is absent (older server)', () => {
    const p = permissionsFrom(me({ permissions: ['view', 'act'], subject: 'u1' }));
    expect(p.actionsEnabled).toBe(true);
    expect(p.can('restart').enabled).toBe(true);
  });
});
