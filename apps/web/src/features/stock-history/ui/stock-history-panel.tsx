import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { JSX } from 'react';
import type { HistoryRange } from '@tw-stock-dashboard/contracts';
import { fetchStockHistory } from '../api/stock-history.api.js';
import { StockHistoryChart } from './stock-history-chart.js';
import type { MaVisibility } from './stock-history-chart.js';

const RANGES: ReadonlyArray<{ value: HistoryRange; label: string }> = [
  { value: '1m', label: '1M' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
];

const MA_KEYS: ReadonlyArray<keyof MaVisibility> = ['ma5', 'ma10', 'ma20', 'ma60'];

export function StockHistoryPanel({ symbol }: { symbol: string }): JSX.Element {
  const [range, setRange] = useState<HistoryRange>('1m');
  const [maVisibility, setMaVisibility] = useState<MaVisibility>({
    ma5: true,
    ma10: true,
    ma20: true,
    ma60: true,
  });

  const history = useQuery({
    queryKey: ['stock-history', symbol, range],
    queryFn: () => fetchStockHistory(symbol, range),
    retry: false,
  });

  const toggleMa = (key: keyof MaVisibility) => {
    setMaVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      <div className="dashboard-card" style={{ padding: '12px 16px' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '16px', alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
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
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
            <span style={{ fontSize: '0.85rem', color: '#64748b', fontWeight: 600, marginRight: '4px' }}>均線</span>
            {MA_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                className="btn-control"
                aria-pressed={maVisibility[key]}
                onClick={() => toggleMa(key)}
              >
                {key.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {history.isPending && <p style={{ color: '#64748b' }}>歷史資料載入中…</p>}
      {history.isError && <p style={{ color: '#dc2626' }}>歷史資料載入失敗，請稍後再試</p>}
      {history.isSuccess && history.data.candles.length === 0 && <p style={{ color: '#64748b' }}>暫無歷史交易資料</p>}
      {history.isSuccess && history.data.candles.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div className="chart-card">
            <StockHistoryChart candles={history.data.candles} maVisibility={maVisibility} />
          </div>

          <div className="table-card">
            <h4 style={{ margin: '0 0 12px 0', fontSize: '0.95rem', color: '#64748b' }}>最近交易資料</h4>
            <table>
              <thead>
                <tr>
                  <th>日期</th>
                  <th>開盤</th>
                  <th>最高</th>
                  <th>最低</th>
                  <th>收盤</th>
                  <th>成交量</th>
                </tr>
              </thead>
              <tbody>
                {history.data.candles
                  .slice(-5)
                  .reverse()
                  .map((candle) => (
                    <tr key={candle.date}>
                      <td>{candle.date}</td>
                      <td>{candle.open.toLocaleString()}</td>
                      <td>{candle.high.toLocaleString()}</td>
                      <td>{candle.low.toLocaleString()}</td>
                      <td>{candle.close.toLocaleString()}</td>
                      <td>{candle.volume.toLocaleString()}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
