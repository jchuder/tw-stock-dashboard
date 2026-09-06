import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { toast } from 'sonner';
import { fetchStockQuote, StockQuoteRequestError } from '../api/stock-quote.api.js';

const FALLBACK_TOAST = 'Fugle 即時行情暫時無法使用，已自動切換至 TWSE MIS';
const RECOVERY_TOAST = 'Fugle 行情服務已恢復，資料來源已切回 Fugle';

const PROVIDER_LABELS = {
  fugle: 'Fugle',
  'twse-mis': 'TWSE MIS',
} as const;

const MARKET_LABELS = {
  TWSE: '上市',
  TPEX: '上櫃',
} as const;

const COLOR_UP = '#dc2626';
const COLOR_DOWN = '#16a34a';
const COLOR_FLAT = '#64748b';

function formatSigned(value: number, suffix = ''): string {
  return `${value >= 0 ? '+' : ''}${value}${suffix}`;
}
function formatNullable(value: number | null): string {
  return value === null ? '—' : value.toLocaleString();
}

export function StockQuotePanel({
  requestedSymbol,
  searchSeq,
  onQuoteResolved,
  isInWatchlist,
  onToggleWatchlist,
}: {
  requestedSymbol?: string | null;
  searchSeq?: number;
  onQuoteResolved?: (stock: { symbol: string; name: string }) => void;
  isInWatchlist?: boolean;
  onToggleWatchlist?: () => void;
}): JSX.Element {
  const previousProvider = useRef<'fugle' | 'twse-mis' | null>(null);

  const quote = useQuery({
    queryKey: ['stock-quote', requestedSymbol, searchSeq],
    queryFn: () => {
      if (requestedSymbol === null || requestedSymbol === undefined) {
        throw new Error('No symbol submitted');
      }
      return fetchStockQuote(requestedSymbol);
    },
    enabled: requestedSymbol !== null && requestedSymbol !== undefined,
    retry: false,
  });

  useEffect(() => {
    if (quote.isSuccess && quote.data && quote.data.symbol === requestedSymbol) {
      onQuoteResolved?.({ symbol: quote.data.symbol, name: quote.data.name });
    }
  }, [quote.isSuccess, quote.data, requestedSymbol, onQuoteResolved]);

  useEffect(() => {
    const data = quote.data;
    // A cache hit only replays an earlier provenance: badge, never a
    // transition toast. The ref stays untouched so the next live response
    // still compares against the last live provider.
    if (!data || data.source.cacheHit) {
      return;
    }
    const current = data.source.provider;
    const previous = previousProvider.current;
    if (previous === null && current === 'twse-mis' && data.source.fallbackUsed) {
      toast(FALLBACK_TOAST, { duration: 5000 });
    } else if (previous === 'fugle' && current === 'twse-mis') {
      toast(FALLBACK_TOAST, { duration: 5000 });
    } else if (previous === 'twse-mis' && current === 'fugle') {
      toast(RECOVERY_TOAST, { duration: 5000 });
    }
    previousProvider.current = current;
  }, [quote.data]);

  const source = quote.data?.source;

  if (requestedSymbol === null || requestedSymbol === undefined) {
    return <section aria-label="個股行情" />;
  }

  return (
    <section aria-label="個股行情">
      {quote.isPending && <p style={{ color: '#64748b', margin: '8px 0 0' }}>載入中…</p>}
      {quote.isError && (
        quote.error instanceof StockQuoteRequestError && quote.error.status === 404 ? (
          <p style={{ color: '#dc2626', margin: '8px 0 0' }}>查無此股票代號</p>
        ) : (
          <p style={{ color: '#dc2626', margin: '8px 0 0' }}>查詢失敗，請稍後再試</p>
        )
      )}
      {quote.isSuccess && source && (
        <div data-testid="stock-quote-info">
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              flexWrap: 'wrap',
              marginBottom: '10px',
            }}
          >
            <span data-testid="stock-quote-title" style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
              {quote.data.symbol} {quote.data.name}
            </span>
            <span data-testid="stock-quote-market" className="badge-market">
              {MARKET_LABELS[quote.data.market]}
            </span>
            <button
              type="button"
              onClick={onToggleWatchlist}
              disabled={onToggleWatchlist === undefined}
              aria-pressed={isInWatchlist === true}
              aria-label={isInWatchlist === true ? '從自選移除' : '加入自選'}
              title={isInWatchlist === true ? '從自選移除' : '加入自選'}
              className="btn-star"
            >
              {isInWatchlist === true ? '★' : '☆'}
            </button>
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              gap: '14px',
              flexWrap: 'wrap',
              marginBottom: '8px',
            }}
          >
            <span
              data-testid="stock-quote-price"
              style={{ fontSize: '2rem', fontWeight: '800', letterSpacing: '-0.02em' }}
            >
              {quote.data.price}
            </span>
            <ChangeLine
              change={quote.data.change}
              changePercent={quote.data.changePercent}
              previousClose={quote.data.previousClose}
            />
          </div>
          <div data-testid="focus-quote-grid" className="focus-quote-grid">
            <QuoteCell label="開盤" value={formatNullable(quote.data.openPrice)} />
            <QuoteCell label="最高" value={formatNullable(quote.data.highPrice)} />
            <QuoteCell label="最低" value={formatNullable(quote.data.lowPrice)} />
            <QuoteCell
              label="成交量"
              value={quote.data.tradeVolume === null ? '—' : quote.data.tradeVolume.toLocaleString()}
            />
            <QuoteCell label="漲停價" value={formatNullable(quote.data.limitUpPrice)} />
            <QuoteCell label="跌停價" value={formatNullable(quote.data.limitDownPrice)} />
          </div>
          <div className="quote-meta-row">
            <span>交易日行情{quote.data.tradeDate !== null ? ` ${quote.data.tradeDate}` : ''}</span>
            <span>昨收 {quote.data.previousClose}</span>
            <span>資料來源：{PROVIDER_LABELS[source.provider]}</span>
            {source.cacheHit && <span className="badge-cache">快取</span>}
            {source.asOf !== null && <span>資料時間：{new Date(source.asOf).toLocaleString()}</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function ChangeLine({
  change,
  changePercent,
  previousClose,
}: {
  change: number;
  changePercent: number;
  previousClose: number;
}): JSX.Element {
  if (change > 0) {
    return (
      <span data-testid="stock-quote-change" style={{ fontSize: '1.1rem', fontWeight: '700', color: COLOR_UP }}>
        較前一交易日 上漲 {change} ({formatSigned(changePercent, '%')})
      </span>
    );
  }
  if (change < 0) {
    return (
      <span data-testid="stock-quote-change" style={{ fontSize: '1.1rem', fontWeight: '700', color: COLOR_DOWN }}>
        較前一交易日 下跌 {Math.abs(change)} ({formatSigned(changePercent, '%')})
      </span>
    );
  }
  return (
    <span data-testid="stock-quote-change" style={{ fontSize: '1.1rem', fontWeight: '700', color: COLOR_FLAT }}>
      較前一交易日持平 (昨收 {previousClose})
    </span>
  );
}

function QuoteCell({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <div className="focus-quote-cell">
      <span className="focus-quote-cell-label">{label}</span>
      <span className="focus-quote-cell-value">{value}</span>
    </div>
  );
}
