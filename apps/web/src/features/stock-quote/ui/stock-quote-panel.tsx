import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { fetchStockQuote } from '../api/stock-quote.api.js';

function formatSigned(value: number, suffix = ''): string {
  return `${value >= 0 ? '+' : ''}${value}${suffix}`;
}

export function StockQuotePanel(): JSX.Element {
  const [input, setInput] = useState('');
  const [submitted, setSubmitted] = useState<string | null>(null);
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

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const symbol = input.trim();
    if (symbol.length > 0) {
      setSubmitted(symbol);
    }
  };

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
      {quote.isError && <p>查詢失敗，請稍後再試</p>}
      {quote.isSuccess && (
        <div>
          <p>
            {quote.data.symbol} {quote.data.name}
          </p>
          <p>{quote.data.price}</p>
          <p>{formatSigned(quote.data.change)}</p>
          <p>{formatSigned(quote.data.changePercent, '%')}</p>
        </div>
      )}
    </section>
  );
}
