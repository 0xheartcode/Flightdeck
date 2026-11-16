import { describe, expect, it } from 'vitest';
import { boolFlag, FEATURE_PROFILES, parseList, parseProfile } from './config.js';

describe('parseList (role lists)', () => {
  it('splits on commas and newlines, trimming and dropping empties', () => {
    expect(parseList('operator,admin')).toEqual(['operator', 'admin']);
    expect(parseList(' operator , admin ')).toEqual(['operator', 'admin']);
    expect(parseList('operator\nadmin')).toEqual(['operator', 'admin']);
    expect(parseList('operator, ,admin,')).toEqual(['operator', 'admin']);
  });

  it('returns an empty list for empty or undefined input', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList(undefined)).toEqual([]);
    expect(parseList('  ')).toEqual([]);
    expect(parseList(',,')).toEqual([]);
  });

  it('keeps a single role', () => {
    expect(parseList('admin')).toEqual(['admin']);
  });
});

describe('deployment profiles', () => {
  it('parses only the three valid tiers', () => {
    expect(parseProfile('lite')).toBe('lite');
    expect(parseProfile('medium')).toBe('medium');
    expect(parseProfile('full')).toBe('full');
    expect(parseProfile('nano')).toBeUndefined();
    expect(parseProfile('')).toBeUndefined();
    expect(parseProfile(undefined)).toBeUndefined();
  });

  it('maps tiers to coherent feature-flag defaults', () => {
    expect(FEATURE_PROFILES.lite).toEqual({
      actionsEnabled: false,
      transmitterEnabled: false,
      agentTokenStoreEnabled: false,
    });
    // MEDIUM and FULL share the same boolean flags (FULL adds infra, not flags).
    expect(FEATURE_PROFILES.medium).toEqual(FEATURE_PROFILES.full);
    expect(FEATURE_PROFILES.full).toEqual({
      actionsEnabled: true,
      transmitterEnabled: true,
      agentTokenStoreEnabled: true,
    });
  });

  it('lets an explicit FD_* override the profile, else falls back to base', () => {
    // Explicit env wins over everything.
    expect(boolFlag('true', false, false)).toBe(true);
    expect(boolFlag('false', true, true)).toBe(false);
    // No explicit env: the profile default applies.
    expect(boolFlag(undefined, true, false)).toBe(true);
    expect(boolFlag(undefined, false, true)).toBe(false);
    // No env and no profile: the flag's base default (today's behavior).
    expect(boolFlag(undefined, undefined, true)).toBe(true);
    expect(boolFlag(undefined, undefined, false)).toBe(false);
    // A non-boolean env value is ignored, not treated as true.
    expect(boolFlag('yes', undefined, false)).toBe(false);
  });
});
