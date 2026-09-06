import { describe, expect, it } from 'vitest';
import { formatTaipeiDate, formatTaipeiDateTime } from './format-taipei.js';

describe('format-taipei', () => {
  it('formats an ISO instant as Taipei wall-clock YYYY/MM/DD HH:mm:ss', () => {
    expect(formatTaipeiDateTime('2026-09-04T05:30:05.000Z')).toBe('2026/09/04 13:30:05');
  });

  it('rolls the Taipei date forward past midnight UTC', () => {
    // 2026-09-04T16:30:00Z is already 2026-09-05 in Taipei.
    expect(formatTaipeiDateTime('2026-09-04T16:30:00.000Z')).toBe('2026/09/05 00:30:00');
  });

  it('formats an EOD date as slash-separated YYYY/MM/DD', () => {
    expect(formatTaipeiDate('2026-09-04')).toBe('2026/09/04');
  });
});
