import { useQuery } from '@tanstack/react-query';
import type { JSX } from 'react';
import type { MarketIndexSnapshot } from '@tw-stock-dashboard/contracts';
import { formatTaipeiDate } from '../../../shared/datetime/format-taipei.js';
import { fetchMarketOverview } from '../api/market-overview.api.js';

function formatIndexChange(change: number, percent: number): string {
  const arrow = change > 0 ? '▲' : change < 0 ? '▼' : '';
  const sign = change > 0 ? '+' : '';
  const body = `${sign}${change.toFixed(2)} (${sign}${percent.toFixed(2)}%)`;
  return arrow === '' ? body : `${arrow} ${body}`;
}

function formatYiAmount(amount: number): string {
  const yi = amount / 100_000_000;
  const sign = yi > 0 ? '+' : '';
  return `${sign}${yi.toFixed(1)} 億`;
}

function changeClass(value: number): string {
  if (value > 0) return 'price-up';
  if (value < 0) return 'price-down';
  return 'price-neutral';
}

function IndexCard({
  title,
  snapshot,
}: {
  title: string;
  snapshot: MarketIndexSnapshot;
}): JSX.Element {
  return (
    <article className="dashboard-card market-card" data-testid={`market-index-${title}`}>
      <div className="card-title">{title}</div>
      <div className="big-number">{snapshot.close.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      <div className={`index-change ${changeClass(snapshot.change)}`}>
        {formatIndexChange(snapshot.change, snapshot.changePercent)}
      </div>
      <div className="mini-meta">{formatTaipeiDate(snapshot.asOf)} 收盤</div>
    </article>
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
    <section aria-label="市場概況" style={{ marginBottom: '16px' }}>
      <div className="market-overview-grid">
        <IndexCard title="加權指數 (TAIEX)" snapshot={taiex} />
        <IndexCard title="櫃買指數 (OTC)" snapshot={otc} />

        <article className="dashboard-card market-card" data-testid="market-institutional">
          <div className="card-title">三大法人最近一日買賣超</div>
          <div className="institution-summary">
            <div className="institution-total">
              <div className={`big-number ${changeClass(institutional.totalNetAmount)}`}>
                {formatYiAmount(institutional.totalNetAmount)}
              </div>
              <div className="mini-meta">盤後資料 · {formatTaipeiDate(institutional.asOf)}</div>
            </div>
            <div className="institution-lines">
              <div className="inst-row">
                <span>外資</span>
                <span className={`inst-value ${changeClass(institutional.foreignNetAmount)}`}>
                  {formatYiAmount(institutional.foreignNetAmount)}
                </span>
              </div>
              <div className="inst-row">
                <span>投信</span>
                <span className={`inst-value ${changeClass(institutional.investmentTrustNetAmount)}`}>
                  {formatYiAmount(institutional.investmentTrustNetAmount)}
                </span>
              </div>
              <div className="inst-row">
                <span>自營商</span>
                <span className={`inst-value ${changeClass(institutional.dealerNetAmount)}`}>
                  {formatYiAmount(institutional.dealerNetAmount)}
                </span>
              </div>
            </div>
          </div>
        </article>
      </div>
    </section>
  );
}
