import { useState } from 'react';
import type { JSX } from 'react';
import { StockHistoryPanel } from '../../../features/stock-history/index.js';
import { StockQuotePanel } from '../../../features/stock-quote/index.js';

// Quote validation gates history: only successful quotes reveal history.
// Features never import each other; this widget is their only composition seam.
export function StockAnalysis(): JSX.Element {
  const [validatedSymbol, setValidatedSymbol] = useState<string | null>(null);

  const onSymbolSubmitted = (symbol: string) => {
    if (symbol !== validatedSymbol) {
      setValidatedSymbol(null);
    }
  };

  return (
    <section>
      <StockQuotePanel
        onSymbolSubmitted={onSymbolSubmitted}
        onQuoteResolved={setValidatedSymbol}
      />
      {validatedSymbol !== null && <StockHistoryPanel symbol={validatedSymbol} />}
    </section>
  );
}
