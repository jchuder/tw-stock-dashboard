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

const MA_KEYS: ReadonlyArray<{ key: keyof MaVisibility; label: string }> = [
  { key: 'ma5', label: 'MA5' },
  { key: 'ma10', label: 'MA10' },
  { key: 'ma20', label: 'MA20' },
  { key: 'ma60', label: 'MA60' },
];

const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '5m': '5 分鐘 K',
  '1d': '日 K',
};

const VOLUME_UNIT_LABELS = {
  lot: '成交量（張）',
  share: '成交量（股）',
} as const;

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
          <div className="periods" role="group" aria-label="K 線期間">
            {RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`period-btn${range === option.value ? ' active' : ''}`}
                aria-pressed={range === option.value}
                onClick={() => setRange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
          <div className="chart-legend" aria-label="均線圖例，點選切換顯示">
            {MA_KEYS.map(({ key, label }) => {
              const visible = maVisibility[key];
              return (
                <button
                  key={key}
                  type="button"
                  className={`legend-item series-legend-toggle${visible ? '' : ' is-off'}`}
                  aria-pressed={visible}
                  aria-label={`${label} ${visible ? '顯示中' : '已隱藏'}，點選切換`}
                  title={`切換 ${label}`}
                  onClick={() => toggleMa(key)}
                >
                  <span aria-hidden="true" className={`legend-swatch ${key}`} />
                  {label}
                </button>
              );
            })}
            <span className="chart-toggle-hint">點按左側圖例可切換顯示</span>
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
              {TIMEFRAME_LABELS[history.data.timeframe]} · {VOLUME_UNIT_LABELS[history.data.volumeUnit]}
            </p>
            <StockHistoryChart candles={history.data.candles} timeframe={history.data.timeframe} maVisibility={maVisibility} />
          </div>

          <div className="table-card">
            <div className="section-head">
              <h3>近期交易資料</h3>
              <span className="mini-meta" style={{ fontSize: '12px' }}>最近 5 個交易日</span>
            </div>
            {tablePending && <p style={{ color: '#64748b' }}>表格載入中…</p>}
            {tableError && <p style={{ color: '#dc2626' }}>表格載入失敗，請稍後再試</p>}
            {tableCandles !== null && tableCandles.length > 0 && (
              <table data-testid="recent-trading-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>開盤價</th>
                    <th>收盤價</th>
                    <th>最高價</th>
                    <th>最低價</th>
                    <th>成交量（股）</th>
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
