import { describe, expect, it } from 'vitest';
import type { StockHistoryResponse } from '@tw-stock-dashboard/contracts';
import { formatChartSourceText, getHistoryDisplayLabels, getHistoryTableHeaders } from './stock-history-panel.js';

describe('stock history panel display semantics', () => {
  it('labels ESB history as TPEx official average-price data', () => {
    const source: StockHistoryResponse['source'] = {
      provider: 'tpex-esb',
      mode: 'eod',
      asOf: '2026-08-06',
    };

    expect(formatChartSourceText(source)).toBe('TPEx 興櫃 · 官方日均價 · 更新至 2026/08/06');
  });

  it('uses average-basis columns for ESB rows', () => {
    expect(getHistoryTableHeaders('average')).toEqual(['日期', '最高價', '最低價', '平均價', '成交量（股）']);
    expect(getHistoryTableHeaders('close')).toEqual(['日期', '開盤價', '收盤價', '最高價', '最低價', '成交量（股）']);
  });

  it('uses daily average-price labels instead of candlestick labels for ESB', () => {
    expect(getHistoryDisplayLabels('average', '1d')).toEqual({
      timeframeLabel: '每日',
      movingAverageLabel: 'MA 依日均價計算',
      periodsAriaLabel: '歷史期間',
    });
    expect(getHistoryDisplayLabels('close', '5m')).toEqual({
      timeframeLabel: '5 分鐘 K',
      movingAverageLabel: 'MA 依目前 K 線週期計算',
      periodsAriaLabel: 'K 線期間',
    });
  });
});
