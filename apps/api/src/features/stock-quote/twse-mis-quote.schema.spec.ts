import { describe, expect, it } from 'vitest';
import { parseMisSessionTime } from './twse-mis-quote.schema.js';

describe('parseMisSessionTime', () => {
  it.each([
    ['13:30:00', '13:30:00'],
    ['23:59:59', '23:59:59'],
    ['00:00:00', '00:00:00'],
  ])('accepts %s', (raw, expected) => {
    expect(parseMisSessionTime(raw)).toBe(expected);
  });

  it.each([['24:00:00'], ['13:60:00'], ['13:30:60'], ['99:99:99'], ['-'], ['closed'], ['13:30']])(
    'rejects %s',
    (raw) => {
      expect(parseMisSessionTime(raw)).toBeNull();
    },
  );

  it('rejects undefined', () => {
    expect(parseMisSessionTime(undefined)).toBeNull();
  });
});
