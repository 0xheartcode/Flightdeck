import { describe, expect, it } from 'vitest';
import { issueLocalSession, LOCAL_SESSION_COOKIE, readLocalSession } from './session.js';
import { permissionsForRoles } from './types.js';

const SECRET = 'session-test-secret';

describe('local session', () => {
  it('round-trips a user id through a signed cookie', () => {
    const value = issueLocalSession(SECRET, 'u_abc');
    const header = `${LOCAL_SESSION_COOKIE}=${value}; other=1`;
    expect(readLocalSession(SECRET, header)).toBe('u_abc');
  });

  it('rejects a tampered or wrongly-signed cookie', () => {
    const value = issueLocalSession(SECRET, 'u_abc');
    expect(readLocalSession('different-secret', `${LOCAL_SESSION_COOKIE}=${value}`)).toBeNull();
    expect(readLocalSession(SECRET, `${LOCAL_SESSION_COOKIE}=${value}tamper`)).toBeNull();
    expect(readLocalSession(SECRET, undefined)).toBeNull();
    expect(readLocalSession(SECRET, 'something=else')).toBeNull();
  });
});

describe('permissionsForRoles', () => {
  it('maps roles to the view/act/reveal model', () => {
    expect([...permissionsForRoles(['viewer'])]).toEqual(['view']);
    expect([...permissionsForRoles(['operator'])].sort()).toEqual(['act', 'view']);
    expect([...permissionsForRoles(['admin'])].sort()).toEqual(['act', 'reveal', 'view']);
  });
});
