import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { MarketIndexSnapshot } from '@tw-stock-dashboard/contracts';
import { fetchMarketOverview } from '../api/market-overview.api.js';

const COLOR_UP = '#dc2626'; // 紅漲
const COLOR_DOWN = '#16a34a'; // 綠跌

function formatNumberWithCommas(value: number): string {
  return value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatIndexChange(change: number, percent: number): string {
  const sign = change > 0 ? '+' : '';
  const formattedChange = `${sign}${change.toFixed(2)}`;
  const formattedPercent = `${sign}${percent.toFixed(2)}%`;
  return `${formattedChange} (${formattedPercent})`;
}

function formatYiAmount(amount: number): string {
  const yi = amount / 100_000_000;
  const sign = yi > 0 ? '+' : '';
  return `${sign}${yi.toFixed(1)} 億`;
}

function getChangeColor(value: number): string {
  if (value > 0) return COLOR_UP;
  if (value < 0) return COLOR_DOWN;
  return 'inherit';
}

function IndexCard({
  title,
  snapshot,
}: {
  title: string;
  snapshot: MarketIndexSnapshot;
}): JSX.Element {
  const color = getChangeColor(snapshot.change);

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: '8px',
        padding: '16px',
        minWidth: '200px',
      }}
      data-testid={`market-index-${title}`}
    >
      <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>{title}</h3>
      <div style={{ fontSize: '1.5rem', fontWeight: 'bold', marginBottom: '4px' }}>
        {formatNumberWithCommas(snapshot.close)}
      </div>
      <div style={{ color, fontWeight: 'bold', marginBottom: '8px' }}>
        {formatIndexChange(snapshot.change, snapshot.changePercent)}
      </div>
      <div style={{ fontSize: '0.85rem', color: '#6b7280' }}>
        {snapshot.asOf} 收盤
      </div>
    </div>
  );
}

export function MarketOverviewPanel(): JSX.Element {
  const query = useQuery({
    queryKey: ['market-overview'],
    queryFn: fetchMarketOverview,
    retry: false,
  });

  if (query.isPending) {
    return <section aria-label="市場概況"><p>載入中…</p></section>;
  }

  if (query.isError || !query.data) {
    return (
      <section aria-label="市場概況">
        <p>市場概況載入失敗</p>
      </section>
    );
  }

  const { taiex, otc, institutional } = query.data;

  return (
    <section aria-label="市場概況" style={{ marginBottom: '24px' }}>
      <h2>市場概況</h2>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '16px',
          alignItems: 'flex-start',
        }}
      >
        <IndexCard title="加權指數" snapshot={taiex} />
        <IndexCard title="櫃買指數" snapshot={otc} />

        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: '8px',
            padding: '16px',
            minWidth: '220px',
          }}
          data-testid="market-institutional"
        >
          <h3 style={{ margin: '0 0 8px 0', fontSize: '1.1rem' }}>上市三大法人</h3>
          <div style={{ fontSize: '0.85rem', color: '#6b7280', marginBottom: '8px' }}>
            {institutional.asOf}
          </div>
          <table style={{ width: '100%', fontSize: '0.95rem' }}>
            <tbody>
              <tr>
                <td>外資</td>
                <td
                  style={{
                    textAlign: 'right',
                    color: getChangeColor(institutional.foreignNetAmount),
                    fontWeight: 'bold',
                  }}
                >
                  {formatYiAmount(institutional.foreignNetAmount)}
                </td>
              </tr>
              <tr>
                <td>投信</td>
                <td
                  style={{
                    textAlign: 'right',
                    color: getChangeColor(institutional.investmentTrustNetAmount),
                    fontWeight: 'bold',
                  }}
                >
                  {formatYiAmount(institutional.investmentTrustNetAmount)}
                </td>
              </tr>
              <tr>
                <td>自營商</td>
                <td
                  style={{
                    textAlign: 'right',
                    color: getChangeColor(institutional.dealerNetAmount),
                    fontWeight: 'bold',
                  }}
                >
                  {formatYiAmount(institutional.dealerNetAmount)}
                </td>
              </tr>
              <tr style={{ borderTop: '1px solid #e5e7eb' }}>
                <td style={{ paddingTop: '6px', fontWeight: 'bold' }}>合計</td>
                <td
                  style={{
                    textAlign: 'right',
                    paddingTop: '6px',
                    color: getChangeColor(institutional.totalNetAmount),
                    fontWeight: 'bold',
                  }}
                >
                  {formatYiAmount(institutional.totalNetAmount)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
