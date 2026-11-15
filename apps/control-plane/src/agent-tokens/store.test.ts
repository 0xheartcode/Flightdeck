import { describe, expect, it } from 'vitest';
import { AgentTokenStore } from './store.js';

describe('AgentTokenStore', () => {
  it('issues a token once and never returns the secret again', () => {
    const store = new AgentTokenStore();
    const { token, secret } = store.create('vega');
    expect(secret).toBeTruthy();
    expect(token.name).toBe('vega');
    expect(token.hint).toBe(secret.slice(-4));
    // The listed/serialised token exposes only the hint, never the secret.
    const listed = store.list();
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain(secret);
    expect(listed[0]).not.toHaveProperty('secret');
    expect(listed[0]).not.toHaveProperty('token_hash');
  });

  it('verifies a valid token to its agent name and records last seen', () => {
    const store = new AgentTokenStore();
    const { token, secret } = store.create('vega');
    expect(store.list()[0]?.lastSeenAt).toBeNull();
    expect(store.verify(secret)).toBe('vega');
    expect(store.verify('wrong')).toBeNull();
    expect(store.verify(undefined)).toBeNull();
    const after = store.list().find((t) => t.id === token.id);
    expect(after?.lastSeenAt).toBeTypeOf('number');
  });

  it('stops authenticating a revoked token but keeps it listed', () => {
    const store = new AgentTokenStore();
    const { token, secret } = store.create('vega');
    expect(store.revoke(token.id)).toBe(true);
    expect(store.verify(secret)).toBeNull();
    expect(store.list().find((t) => t.id === token.id)?.revokedAt).toBeTypeOf('number');
    expect(store.activeCount).toBe(0);
  });

  it('rotates a token: the old secret stops working, the new one authenticates', () => {
    const store = new AgentTokenStore();
    const { token, secret } = store.create('vega');
    const rotated = store.rotate(token.id);
    expect(rotated).not.toBeNull();
    expect(rotated?.secret).not.toBe(secret);
    expect(store.verify(secret)).toBeNull();
    expect(store.verify(rotated?.secret)).toBe('vega');
  });

  it('deletes a token entirely', () => {
    const store = new AgentTokenStore();
    const { token, secret } = store.create('vega');
    expect(store.delete(token.id)).toBe(true);
    expect(store.verify(secret)).toBeNull();
    expect(store.list()).toHaveLength(0);
  });
});
