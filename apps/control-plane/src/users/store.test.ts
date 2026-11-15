import { describe, expect, it } from 'vitest';
import { UserStore } from './store.js';

describe('UserStore', () => {
  it('creates a user and never exposes the password hash', () => {
    const store = new UserStore();
    const user = store.create('jonas', 'correct horse battery', ['admin']);
    expect(user.username).toBe('jonas');
    expect(user.roles).toEqual(['admin']);
    expect(user.disabled).toBe(false);
    expect(JSON.stringify(user)).not.toContain('correct horse battery');
    expect(user).not.toHaveProperty('password_hash');
    expect(user).not.toHaveProperty('passwordHash');
  });

  it('verifies credentials and rejects wrong, unknown, or disabled users', () => {
    const store = new UserStore();
    store.create('jonas', 'correct horse battery', ['operator']);
    expect(store.verifyCredentials('jonas', 'correct horse battery')?.username).toBe('jonas');
    expect(store.verifyCredentials('jonas', 'wrong')).toBeNull();
    expect(store.verifyCredentials('nobody', 'correct horse battery')).toBeNull();

    const user = store.getByUsername('jonas')!;
    store.setDisabled(user.id, true);
    expect(store.verifyCredentials('jonas', 'correct horse battery')).toBeNull();
  });

  it('treats usernames case-insensitively and enforces uniqueness', () => {
    const store = new UserStore();
    store.create('Jonas', 'correct horse battery', ['viewer']);
    expect(store.getByUsername('jonas')?.username).toBe('Jonas');
    expect(() => store.create('jonas', 'another password x', ['viewer'])).toThrow();
  });

  it('updates roles and rehashes on password change', () => {
    const store = new UserStore();
    const user = store.create('lea', 'first password xx', ['viewer']);
    expect(store.setRoles(user.id, ['admin'])?.roles).toEqual(['admin']);
    store.setPassword(user.id, 'second password xx');
    expect(store.verifyCredentials('lea', 'first password xx')).toBeNull();
    expect(store.verifyCredentials('lea', 'second password xx')?.username).toBe('lea');
  });

  it('counts enabled admins (for last-admin protection)', () => {
    const store = new UserStore();
    const a = store.create('a', 'password one xx', ['admin']);
    store.create('b', 'password two xx', ['operator']);
    expect(store.enabledAdminCount).toBe(1);
    const c = store.create('c', 'password three x', ['admin']);
    expect(store.enabledAdminCount).toBe(2);
    store.setDisabled(c.id, true);
    expect(store.enabledAdminCount).toBe(1);
    expect(a.roles).toEqual(['admin']);
  });
});
