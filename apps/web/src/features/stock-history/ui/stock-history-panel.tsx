import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { Candle, HistoryRange } from '@tw-stock-dashboard/contracts';
import { fetchStockHistory } from '../api/stock-history.api.js';
import { StockHistoryChart } from './stock-history-chart.js';
import type { MaVisibility } from './stock-history-chart.js';

const HISTORY_RANGES: ReadonlyArray<{ value: HistoryRange; label: string }> = [
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

const TIMEFRAME_LABELS = {
  '5m': '5 分鐘 K',
  '1d': '日 K',
} as const;

const VOLUME_UNIT_LABELS = {
  lot: '成交量（張）',
  share: '成交量（股）',
} as const;

function isIntradayRange(range: HistoryRange): boolean {
  return range === '1d' || range === '3d' || range === '5d';
}

export interface HistoryControls {
  range: HistoryRange;
  onRangeChange: (range: HistoryRange) => void;
  maVisibility: MaVisibility;
  onToggleMa: (key: keyof MaVisibility) => void;
}

// Focus-card section: MA legend, chart, then periods below the chart. Plain
// divs — the card wrapper lives in the StockAnalysis composition so quote,
// metrics, legend, chart, and periods share one focus card.
export function StockHistoryFocus({
  symbol,
  range,
  onRangeChange,
  maVisibility,
  onToggleMa,
}: {
  symbol: string;
} & HistoryControls): JSX.Element {
  const history = useQuery({
    queryKey: ['stock-history', symbol, range],
    queryFn: () => fetchStockHistory(symbol, range),
    retry: false,
  });

  return (
    <section aria-label="股價走勢" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
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
              onClick={() => onToggleMa(key)}
            >
              <span aria-hidden="true" className={`legend-swatch ${key}`} />
              {label}
            </button>
          );
        })}
        <span className="chart-toggle-hint">點按左側圖例可切換顯示</span>
      </div>
      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '0' }}>
        MA 依目前 K 線週期計算
      </p>

      {history.isPending && <p style={{ color: 'var(--text-muted)' }}>歷史資料載入中…</p>}
      {history.isError && <p style={{ color: 'var(--color-up)' }}>歷史資料載入失敗，請稍後再試</p>}
      {history.isSuccess && history.data.candles.length === 0 && (
        <p style={{ color: 'var(--text-muted)' }}>暫無歷史交易資料</p>
      )}
      {history.isSuccess && history.data.candles.length > 0 && (
        <>
          <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            {TIMEFRAME_LABELS[history.data.timeframe]} · {VOLUME_UNIT_LABELS[history.data.volumeUnit]}
          </p>
          <StockHistoryChart
            candles={history.data.candles}
            timeframe={history.data.timeframe}
            maVisibility={maVisibility}
          />
          <div className="periods" role="group" aria-label="K 線期間">
            {HISTORY_RANGES.map((option) => (
              <button
                key={option.value}
                type="button"
                className={`period-btn${range === option.value ? ' active' : ''}`}
                aria-pressed={range === option.value}
                onClick={() => onRangeChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// Independent recent-trading card: always daily OHLCV. On an intraday chart
// range it runs its own cached 1m daily query; on a daily range it joins the
// same cache key the chart already uses, so no duplicate provider I/O.
export function StockHistoryTable({ symbol, range }: { symbol: string; range: HistoryRange }): JSX.Element {
  const tableRange: HistoryRange = isIntradayRange(range) ? '1m' : range;
  const table = useQuery({
    queryKey: ['stock-history', symbol, tableRange],
    queryFn: () => fetchStockHistory(symbol, tableRange),
    retry: false,
  });

  const tableCandles: ReadonlyArray<Candle> | null = table.data?.candles ?? null;

  return (
    <div className="table-card">
      <div className="section-head">
        <h3>近期交易資料</h3>
        <span className="mini-meta" style={{ fontSize: '12px' }}>
          最近 5 個交易日
        </span>
      </div>
      {table.isPending && <p style={{ color: 'var(--text-muted)' }}>表格載入中…</p>}
      {table.isError && <p style={{ color: 'var(--color-up)' }}>表格載入失敗，請稍後再試</p>}
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
  );
}
