import { describe, expect, it } from 'vitest';
import { cx, formatTime } from './format';

describe('cx', () => {
  it('joins truthy parts and drops falsy ones', () => {
    expect(cx('a', false, 'b', null, undefined, 'c')).toBe('a b c');
  });

  it('returns an empty string when nothing is truthy', () => {
    expect(cx(false, null, undefined)).toBe('');
  });
});

describe('formatTime', () => {
  it('formats as zero-padded HH:MM:SS', () => {
    expect(formatTime(Date.now())).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
});
