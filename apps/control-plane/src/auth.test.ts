import { describe, expect, it } from 'vitest';
import { bearer, safeEqual, tokenOk } from './auth.js';

describe('safeEqual', () => {
  it('is true for equal strings', () => {
    expect(safeEqual('s3cret-token', 's3cret-token')).toBe(true);
  });

  it('is false for different strings, including different lengths', () => {
    expect(safeEqual('s3cret-token', 's3cret-toke')).toBe(false);
    expect(safeEqual('a', 'b')).toBe(false);
    expect(safeEqual('', 'x')).toBe(false);
  });
});

describe('bearer', () => {
  it('extracts a Bearer token', () => {
    expect(bearer('Bearer abc123')).toBe('abc123');
  });

  it('returns undefined for missing, malformed, or non-Bearer headers', () => {
    expect(bearer(undefined)).toBeUndefined();
    expect(bearer('abc123')).toBeUndefined();
    expect(bearer('Basic abc123')).toBeUndefined();
    expect(bearer('Bearer ')).toBeUndefined();
  });
});

describe('tokenOk', () => {
  it('fails closed when no token is configured', () => {
    expect(tokenOk('', 'anything')).toBe(false);
    expect(tokenOk('', undefined)).toBe(false);
  });

  it('rejects a missing or wrong presented token', () => {
    expect(tokenOk('configured', undefined)).toBe(false);
    expect(tokenOk('configured', 'wrong')).toBe(false);
  });

  it('accepts the exact configured token', () => {
    expect(tokenOk('configured', 'configured')).toBe(true);
  });
});
