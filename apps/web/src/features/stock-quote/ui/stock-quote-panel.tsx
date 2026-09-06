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
}: {
  onSymbolSubmitted?: (symbol: string) => void;
  onQuoteResolved?: (symbol: string) => void;
}): JSX.Element {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
  const previousProvider = useRef<'fugle' | 'twse-mis' | null>(null);
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
      onQuoteResolved?.(quote.data.symbol);
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
      <form onSubmit={onSubmit}>
        <input
          aria-label="股票代碼"
          placeholder="2330"
          value={input}
          onChange={(event) => setInput(event.target.value)}
        />
        <button type="submit">查詢</button>
      </form>
      {quote.isPending && submitted !== null && <p>載入中…</p>}
      {quote.isError && (
        quote.error instanceof StockQuoteRequestError && quote.error.status === 404 ? (
          <p>查無此股票代號</p>
        ) : (
          <p>查詢失敗，請稍後再試</p>
        )
      )}
      {quote.isSuccess && source && (
        <div>
          <p>
            {quote.data.symbol} {quote.data.name}
          </p>
          <p>{quote.data.price}</p>
          <p>{formatSigned(quote.data.change)}</p>
          <p>{formatSigned(quote.data.changePercent, '%')}</p>
          <p>資料來源：{PROVIDER_LABELS[source.provider]}</p>
          {source.cacheHit && <p>快取</p>}
          {source.asOf !== null && <p>資料時間：{new Date(source.asOf).toLocaleString()}</p>}
        </div>
      )}
    </section>
  );
}
