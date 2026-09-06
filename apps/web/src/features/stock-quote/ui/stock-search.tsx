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
      <label className="search-box">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          aria-label="全域股票搜尋"
          placeholder="請輸入股票代號"
          autoComplete="off"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          className="search-input"
        />
      </label>
      <button type="submit" className="btn-primary">
        搜尋
      </button>
    </form>
  );
}
