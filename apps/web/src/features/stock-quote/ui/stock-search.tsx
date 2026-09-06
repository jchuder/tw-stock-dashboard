import { useState } from 'react';
import type { FormEvent, JSX } from 'react';

// Global stock search: lives in the dashboard header, not inside the focus
// quote card. No autocomplete — plain symbol submit only.
export function GlobalStockSearch({
  onSearch,
}: {
  onSearch: (symbol: string) => void;
}): JSX.Element {
  const [input, setInput] = useState('');

  const onSubmit = (event: FormEvent): void => {
    event.preventDefault();
    const symbol = input.trim();
    if (symbol.length === 0) {
      return;
    }
    onSearch(symbol);
  };

  return (
    <form onSubmit={onSubmit} className="header-search" role="search" aria-label="全域股票搜尋">
      <input
        aria-label="全域股票搜尋"
        placeholder="輸入股票代號，如 2330"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        className="search-input"
      />
      <button type="submit" className="btn-primary">
        查詢
      </button>
    </form>
  );
}
