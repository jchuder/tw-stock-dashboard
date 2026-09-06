import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { toast } from 'sonner';
import { fetchStockQuote, StockQuoteRequestError } from '../api/stock-quote.api.js';

const FALLBACK_TOAST = 'Fugle 即時行情暫時無法使用，已自動切換至 TWSE MIS';
const RECOVERY_TOAST = 'Fugle 行情服務已恢復，資料來源已切回 Fugle';

const PROVIDER_LABELS = {
  fugle: 'Fugle',
  'twse-mis': 'TWSE MIS',
} as const;

function formatSigned(value: number, suffix = ''): string {
  return `${value >= 0 ? '+' : ''}${value}${suffix}`;
}

export function StockQuotePanel({
  onSymbolSubmitted,
  onQuoteResolved,
  requestedSymbol,
}: {
  onSymbolSubmitted?: (symbol: string) => void;
  onQuoteResolved?: (stock: { symbol: string; name: string }) => void;
  requestedSymbol?: string | null;
}): JSX.Element {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const previousProvider = useRef<'fugle' | 'twse-mis' | null>(null);

  useEffect(() => {
    if (requestedSymbol !== undefined && requestedSymbol !== null && requestedSymbol !== submitted) {
      setInput(requestedSymbol);
      setSubmitted(requestedSymbol);
    }
  }, [requestedSymbol, submitted]);

  const quote = useQuery({
    queryKey: ['stock-quote', submitted],
    queryFn: () => {
      if (submitted === null) {
        throw new Error('No symbol submitted');
      }
      return fetchStockQuote(submitted);
    },
    enabled: submitted !== null,
    retry: false,
  });

  useEffect(() => {
    if (quote.isSuccess && quote.data && submitted !== null && quote.data.symbol === submitted) {
      onQuoteResolved?.({ symbol: quote.data.symbol, name: quote.data.name });
    }
  }, [quote.isSuccess, quote.data, submitted, onQuoteResolved]);

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

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const symbol = input.trim();
    if (symbol.length === 0) {
      return;
    }
    // Re-submitting the same symbol must still refresh: the query key would
    // otherwise be unchanged and nothing would refetch.
    if (symbol === submitted) {
      void quote.refetch();
    } else {
      setSubmitted(symbol);
    }
    onSymbolSubmitted?.(symbol);
  };

  const source = quote.data?.source;

  return (
    <section>
      <form onSubmit={onSubmit} className="search-form">
        <input
          aria-label="股票代碼"
          placeholder="2330"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="search-input"
        />
        <button type="submit" className="btn-primary">查詢</button>
      </form>
      {quote.isPending && submitted !== null && <p style={{ color: '#64748b', margin: '8px 0 0' }}>載入中…</p>}
      {quote.isError && (
        quote.error instanceof StockQuoteRequestError && quote.error.status === 404 ? (
          <p style={{ color: '#dc2626', margin: '8px 0 0' }}>查無此股票代號</p>
        ) : (
          <p style={{ color: '#dc2626', margin: '8px 0 0' }}>查詢失敗，請稍後再試</p>
        )
      )}
      {quote.isSuccess && source && (
        <div data-testid="stock-quote-info" style={{ marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', flexWrap: 'wrap', marginBottom: '6px' }}>
            <span data-testid="stock-quote-title" style={{ fontSize: '1.25rem', fontWeight: 'bold' }}>
              {quote.data.symbol} {quote.data.name}
            </span>
            <span data-testid="stock-quote-price" style={{ fontSize: '1.75rem', fontWeight: '800', letterSpacing: '-0.02em' }}>
              {quote.data.price}
            </span>
            <span
              style={{
                fontSize: '1.1rem',
                fontWeight: '700',
                color: quote.data.change > 0 ? '#dc2626' : quote.data.change < 0 ? '#16a34a' : 'inherit',
              }}
            >
              {formatSigned(quote.data.change)} ({formatSigned(quote.data.changePercent, '%')})
            </span>
          </div>
          <div className="quote-meta-row">
            <span>上市 · 資料來源：{PROVIDER_LABELS[source.provider]}</span>
            {source.cacheHit && <span className="badge-cache">快取</span>}
            {source.asOf !== null && <span>資料時間：{new Date(source.asOf).toLocaleString()}</span>}
          </div>
        </div>
      )}
    </section>
  );
}
