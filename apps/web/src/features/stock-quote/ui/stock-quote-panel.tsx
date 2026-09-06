import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { toast } from 'sonner';
import { fetchStockQuote, StockQuoteRequestError } from '../api/stock-quote.api.js';

const FALLBACK_TOAST = 'Fugle 即時行情暫時無法使用，已自動切換至 TWSE MIS';
const RECOVERY_TOAST = 'Fugle 行情服務已恢復，資料來源已切回 Fugle';

const PROVIDER_LABELS = {
  fugle: 'Fugle API Connected',
  'twse-mis': 'TWSE MIS',
} as const;

const MARKET_LABELS = {
  TWSE: '上市',
  TPEX: '上櫃',
} as const;

const COLOR_UP = '#d94b45';
const COLOR_DOWN = '#169a52';
const COLOR_FLAT = '#59605c';

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
  onQuoteResolved?: (
    stock: { symbol: string; name: string },
    info: { provider: 'fugle' | 'twse-mis'; asOf: string | null },
  ) => void;
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
      onQuoteResolved?.(
        { symbol: quote.data.symbol, name: quote.data.name },
        { provider: quote.data.source.provider, asOf: quote.data.source.asOf },
      );
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
      {quote.isPending && <p style={{ color: 'var(--text-muted)', margin: '8px 0 0' }}>載入中…</p>}
      {quote.isError && (
        quote.error instanceof StockQuoteRequestError && quote.error.status === 404 ? (
          <p style={{ color: 'var(--color-up)', margin: '8px 0 0' }}>查無此股票代號</p>
        ) : (
          <p style={{ color: 'var(--color-up)', margin: '8px 0 0' }}>查詢失敗，請稍後再試</p>
        )
      )}
      {quote.isSuccess && source && (
        <div data-testid="stock-quote-info">
          <div className="eyebrow">焦點個股分析</div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '9px',
              flexWrap: 'wrap',
              marginBottom: '10px',
            }}
          >
            <span data-testid="stock-quote-title" style={{ fontSize: '21px', fontWeight: 'bold', margin: 0 }}>
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
              {isInWatchlist === true ? (
                <>
                  <span className="star-icon" aria-hidden="true">★</span> 已在觀察
                </>
              ) : (
                '☆ 加入觀察'
              )}
            </button>
          </div>
          <div
            role="group"
            aria-label={`目前股價 ${quote.data.price}，較前一交易日${quote.data.change > 0 ? '上漲' : quote.data.change < 0 ? '下跌' : '持平'} ${Math.abs(quote.data.change)}，漲跌幅 ${quote.data.changePercent}%`}
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
            />
          </div>
          <div data-testid="focus-quote-grid" className="focus-quote-grid">
            <QuoteCell label="開盤價" value={formatNullable(quote.data.openPrice)} compare={quote.data.openPrice} previousClose={quote.data.previousClose} />
            <QuoteCell label="最高價" value={formatNullable(quote.data.highPrice)} compare={quote.data.highPrice} previousClose={quote.data.previousClose} />
            <QuoteCell label="最低價" value={formatNullable(quote.data.lowPrice)} compare={quote.data.lowPrice} previousClose={quote.data.previousClose} />
            <QuoteCell
              label="成交量（張）"
              value={quote.data.tradeVolume === null ? '—' : quote.data.tradeVolume.toLocaleString()}
            />
            <QuoteCell label="漲停價" value={formatNullable(quote.data.limitUpPrice)} tone="up" />
            <QuoteCell label="跌停價" value={formatNullable(quote.data.limitDownPrice)} tone="down" />
          </div>
          <div className="quote-meta-row">
            <span>交易日行情{quote.data.tradeDate !== null ? ` ${quote.data.tradeDate}` : ''}</span>
            <span>昨收 {quote.data.previousClose}</span>
            <span>資料來源：{PROVIDER_LABELS[source.provider]}</span>
            {source.cacheHit && <span className="badge-cache">快取</span>}
          </div>
        </div>
      )}
    </section>
  );
}

function ChangeLine({
  change,
  changePercent,
}: {
  change: number;
  changePercent: number;
}): JSX.Element {
  if (change > 0) {
    return (
      <span data-testid="stock-quote-change" style={{ fontSize: '1.1rem', fontWeight: '700', color: COLOR_UP }}>
        ▲ {change} ({formatSigned(changePercent, '%')})
      </span>
    );
  }
  if (change < 0) {
    return (
      <span data-testid="stock-quote-change" style={{ fontSize: '1.1rem', fontWeight: '700', color: COLOR_DOWN }}>
        ▼ {Math.abs(change)} ({formatSigned(changePercent, '%')})
      </span>
    );
  }
  return (
    <span data-testid="stock-quote-change" style={{ fontSize: '1.1rem', fontWeight: '700', color: COLOR_FLAT }}>
      0 (0.00%)
    </span>
  );
}

function QuoteCell({
  label,
  value,
  compare,
  previousClose,
  tone,
}: {
  label: string;
  value: string;
  compare?: number | null;
  previousClose?: number;
  tone?: 'up' | 'down';
}): JSX.Element {
  let toneClass = '';
  if (tone === 'up') {
    toneClass = 'price-up';
  } else if (tone === 'down') {
    toneClass = 'price-down';
  } else if (compare !== null && compare !== undefined && previousClose !== undefined) {
    toneClass = compare > previousClose ? 'price-up' : compare < previousClose ? 'price-down' : '';
  }
  return (
    <div className="focus-quote-cell">
      <span className="focus-quote-cell-label">{label}</span>
      <span className={`focus-quote-cell-value ${toneClass}`}>{value}</span>
    </div>
  );
}
