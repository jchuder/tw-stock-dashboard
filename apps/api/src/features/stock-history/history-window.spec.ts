import { describe, expect, it } from 'vitest';
import { historyWindow } from './history-window.js';

describe('historyWindow', () => {
  it('computes a 1m window ending on the Taipei calendar date', () => {
    // 2026-09-06T12:00:00+08:00
    const nowMs = Date.UTC(2026, 8, 6, 4, 0, 0);

    expect(historyWindow('1m', nowMs)).toEqual({ from: '2026-08-06', to: '2026-09-06' });
  });

  it('computes 3m and 6m windows', () => {
    const nowMs = Date.UTC(2026, 8, 6, 4, 0, 0);

    expect(historyWindow('3m', nowMs)).toEqual({ from: '2026-06-06', to: '2026-09-06' });
    expect(historyWindow('6m', nowMs)).toEqual({ from: '2026-03-06', to: '2026-09-06' });
  });

  it('clamps month-end: March 31 minus one month is February 28', () => {
    // 2026-03-31T00:00:00+08:00; 2026 is not a leap year.
    const nowMs = Date.UTC(2026, 2, 30, 16, 0, 0);

    expect(historyWindow('1m', nowMs)).toEqual({ from: '2026-02-28', to: '2026-03-31' });
  });

  it('clamps to February 29 in a leap year', () => {
    // 2024-03-31T00:00:00+08:00; 2024 is a leap year.
    const nowMs = Date.UTC(2024, 2, 30, 16, 0, 0);

    expect(historyWindow('1m', nowMs)).toEqual({ from: '2024-02-29', to: '2024-03-31' });
  });

  it('uses the Taipei date, not UTC, just after midnight', () => {
    // 2026-09-06T00:30:00+08:00 is still 2026-09-05 in UTC.
    const nowMs = Date.UTC(2026, 8, 5, 16, 30, 0);

    expect(historyWindow('1m', nowMs)).toEqual({ from: '2026-08-06', to: '2026-09-06' });
  });
});
