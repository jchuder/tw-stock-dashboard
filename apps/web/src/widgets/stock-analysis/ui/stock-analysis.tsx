import { useState } from 'react';
import type { JSX } from 'react';
import { StockHistoryPanel } from '../../../features/stock-history/index.js';
import { StockQuotePanel } from '../../../features/stock-quote/index.js';

// One submitted symbol drives both quote and history. Features never import
// each other; this widget is their only composition seam.
export function StockAnalysis(): JSX.Element {
  const [symbol, setSymbol] = useState<string | null>(null);

  return (
    <section>
      <StockQuotePanel onSymbolSubmitted={setSymbol} />
      {symbol !== null && <StockHistoryPanel symbol={symbol} />}
    </section>
  );
}
