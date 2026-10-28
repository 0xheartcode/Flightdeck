import { describe, expect, it } from 'vitest';
import { cx, formatBytes, formatTime } from './format';

describe('formatBytes', () => {
  it('formats common sizes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 * 12.4)).toBe('12.4 MB');
  });

  it('handles invalid input', () => {
    expect(formatBytes(-5)).toBe('0 B');
    expect(formatBytes(NaN)).toBe('0 B');
  });
});

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
