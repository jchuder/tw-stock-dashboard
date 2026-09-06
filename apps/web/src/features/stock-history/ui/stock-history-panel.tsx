import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';
import type { Candle, HistoryRange, Timeframe } from '@tw-stock-dashboard/contracts';
import { fetchStockHistory } from '../api/stock-history.api.js';
import { StockHistoryChart } from './stock-history-chart.js';
import type { MaVisibility } from './stock-history-chart.js';

const RANGES: ReadonlyArray<{ value: HistoryRange; label: string }> = [
  { value: '1d', label: '當日' },
  { value: '3d', label: '3D' },
  { value: '5d', label: '5D' },
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
];

const MA_KEYS: ReadonlyArray<{ key: keyof MaVisibility; label: string; color: string }> = [
  { key: 'ma5', label: 'MA5', color: '#ff9800' },
  { key: 'ma10', label: 'MA10', color: '#2196f3' },
  { key: 'ma20', label: 'MA20', color: '#9c27b0' },
  { key: 'ma60', label: 'MA60', color: '#4caf50' },
];

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '5m': '5 分鐘 K',
  '1d': '日 K',
};

function isIntradayRange(range: HistoryRange): boolean {
  return range === '1d' || range === '3d' || range === '5d';
}

export function StockHistoryPanel({ symbol }: { symbol: string }): JSX.Element {
  const [range, setRange] = useState<HistoryRange>('1d');
  const [maVisibility, setMaVisibility] = useState<MaVisibility>({
    ma5: true,
    ma10: false,
    ma20: false,
    ma60: false,
  });

  const history = useQuery({
    queryKey: ['stock-history', symbol, range],
    queryFn: () => fetchStockHistory(symbol, range),
    retry: false,
  });

  // The recent-trading table always shows daily OHLCV, even while the chart
  // is on an intraday range. The daily query reuses the TanStack cache, so a
  // daily chart range never causes a duplicate provider request.
  const showDailyTable = isIntradayRange(range);
  const dailyHistory = useQuery({
    queryKey: ['stock-history', symbol, '1m' as HistoryRange],
    queryFn: () => fetchStockHistory(symbol, '1m'),
    retry: false,
    enabled: showDailyTable,
  });

  const toggleMa = (key: keyof MaVisibility) => {
    setMaVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const tableCandles: ReadonlyArray<Candle> | null = showDailyTable
    ? (dailyHistory.data?.candles ?? null)
    : (history.data?.candles ?? null);
  const tablePending = showDailyTable ? dailyHistory.isPending : history.isPending;
  const tableError = showDailyTable ? dailyHistory.isError : history.isError;

  return (
    <section aria-label="股價走勢" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="dashboard-card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600, marginRight: '4px' }}>期間</span>
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                className="btn-control"
                aria-pressed={range === option.value}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div
            style={{ display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' }}
            aria-label="均線圖例，點選切換顯示"
          >
            {MA_KEYS.map(({ key, label, color }) => {
              const visible = maVisibility[key];
              return (
                <button
                  key={key}
                  type="button"
                  className="btn-ma-legend"
                  aria-pressed={visible}
                  aria-label={`${label} ${visible ? '顯示中' : '已隱藏'}，點選切換`}
                  onClick={() => toggleMa(key)}
                  style={{ opacity: visible ? 1 : 0.35 }}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      display: 'inline-block',
                      width: '16px',
                      height: '3px',
                      borderRadius: '2px',
                      backgroundColor: color,
                    }}
                  />
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '8px 0 0' }}>MA 依目前 K 線週期計算</p>
      </div>

      {history.isPending && <p style={{ color: '#64748b' }}>歷史資料載入中…</p>}
      {history.isError && <p style={{ color: '#dc2626' }}>歷史資料載入失敗，請稍後再試</p>}
      {history.isSuccess && history.data.candles.length === 0 && <p style={{ color: '#64748b' }}>暫無歷史交易資料</p>}
      {history.isSuccess && history.data.candles.length > 0 && (
        <>
          <div className="chart-card">
            <p style={{ margin: '0 0 8px 0', fontSize: '0.8rem', color: '#64748b' }}>
              {TIMEFRAME_LABELS[history.data.timeframe]}
            </p>
            <StockHistoryChart candles={history.data.candles} maVisibility={maVisibility} />
          </div>

          <div className="table-card">
            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#64748b' }}>最近交易資料</h4>
            {tablePending && <p style={{ color: '#64748b' }}>表格載入中…</p>}
            {tableError && <p style={{ color: '#dc2626' }}>表格載入失敗，請稍後再試</p>}
            {tableCandles !== null && tableCandles.length > 0 && (
              <table data-testid="recent-trading-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>開盤</th>
                    <th>收盤</th>
                    <th>最高</th>
                    <th>最低</th>
                    <th>成交量</th>
                  </tr>
                </thead>
                <tbody>
                  {tableCandles
                    .slice(-5)
                    .reverse()
                    .map((candle) => (
                      <tr key={candle.date}>
                        <td>{candle.date}</td>
                        <td>{candle.open.toLocaleString()}</td>
                        <td>{candle.close.toLocaleString()}</td>
                        <td>{candle.high.toLocaleString()}</td>
                        <td>{candle.low.toLocaleString()}</td>
                        <td>{candle.volume.toLocaleString()}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </section>
  );
}
