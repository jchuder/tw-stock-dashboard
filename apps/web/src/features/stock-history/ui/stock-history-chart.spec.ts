import { describe, expect, it } from 'vitest';
import type { Candle } from '@tw-stock-dashboard/contracts';
import { toAveragePriceSeriesData, toVolumeSeriesData } from './stock-history-chart.js';

function makeCandle(overrides: Partial<Candle> = {}): Candle {
  return {
    date: '2026-08-06',
    open: null,
    high: null,
    low: null,
    close: null,
    average: 235,
    volume: 1200,
    ma5: null,
    ma10: null,
    ma20: null,
    ma60: null,
    ...overrides,
  };
}

describe('stock history chart data mapping', () => {
  it('maps only valid average observations to the average-price line', () => {
    expect(
      toAveragePriceSeriesData(
        [makeCandle(), makeCandle({ date: '2026-08-07', average: null })],
        '1d',
      ),
    ).toEqual([{ time: '2026-08-06', value: 235 }]);
  });

  it('keeps ESB volume visible without inferring an up/down candle color', () => {
    expect(toVolumeSeriesData([makeCandle()], '1d')).toEqual([
      {
        time: '2026-08-06',
        value: 1200,
        color: 'rgba(107, 114, 128, 0.25)',
      },
    ]);
  });
});
