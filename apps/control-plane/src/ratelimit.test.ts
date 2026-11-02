import { describe, expect, it } from 'vitest';
import { RateLimiter } from './ratelimit.js';

describe('RateLimiter', () => {
  it('allows up to the limit then blocks within the window', () => {
    const rl = new RateLimiter(2, 1000);
    expect(rl.allow(0)).toBe(true);
    expect(rl.allow(100)).toBe(true);
    expect(rl.allow(200)).toBe(false); // over the limit
  });

  it('frees capacity as the window slides', () => {
    const rl = new RateLimiter(1, 1000);
    expect(rl.allow(0)).toBe(true);
    expect(rl.allow(500)).toBe(false);
    expect(rl.allow(1001)).toBe(true); // first hit aged out
  });
});
