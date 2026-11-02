import { describe, expect, it } from 'vitest';
import { parseList } from './config.js';

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
