import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { HistoryRange } from '@tw-stock-dashboard/contracts';
import { StockHistoryFocus, StockHistoryTable } from '../../../features/stock-history/index.js';
import type { MaVisibility } from '../../../features/stock-history/ui/stock-history-chart.js';
import { StockQuotePanel } from '../../../features/stock-quote/index.js';
import type { QuoteResolvedInfo } from '../../../features/stock-quote/index.js';
import {
  addToWatchlist,
  loadWatchlist,
  removeFromWatchlist,
  saveWatchlist,
  StockWatchlistPanel,
} from '../../../features/stock-watchlist/index.js';
import type { WatchlistItem } from '../../../features/stock-watchlist/index.js';

function isIntradayRange(range: HistoryRange): boolean {
  return range === '1d' || range === '3d' || range === '5d';
}

// Stock analysis: left focus column (one focus card with quote, legend,
export function StockAnalysis({
  requestedSymbol,
  searchSeq,
  onSymbolSubmitted,
  onProvenance,
}: {
  requestedSymbol: string | null;
  searchSeq: number;
  onSymbolSubmitted: (symbol: string) => void;
  onProvenance?: (
    provenance: {
      provider: 'fugle' | 'twse-mis' | 'tpex-esb';
      asOf: string | null;
      fallbackReason?: 'config_missing' | 'upstream_unavailable' | null;
    } | null,
  ) => void;
}): JSX.Element {
  const [watchlist, setWatchlist] = useState<WatchlistItem[]>(() => loadWatchlist());
  const [validatedStock, setValidatedStock] = useState<{ symbol: string; name: string } | null>(
    null,
  );
  const [range, setRange] = useState<HistoryRange>('1d');
  const [isPublicDataMode, setIsPublicDataMode] = useState(false);
  const [maVisibility, setMaVisibility] = useState<MaVisibility>({
    ma5: true,
    ma10: false,
    ma20: false,
    ma60: false,
  });

  // A new requested symbol invalidates the previous validation until the
  // quote resolves again — this keeps chart/table from showing stale data.
  useEffect(() => {
    if (requestedSymbol !== validatedStock?.symbol) {
      setValidatedStock(null);
      onProvenance?.(null);
    }
  }, [requestedSymbol, validatedStock?.symbol, onProvenance]);

  const handleQuoteResolved = useCallback(
    (stock: { symbol: string; name: string }, info: QuoteResolvedInfo): void => {
      const publicMode = info.fallbackReason === 'config_missing';
      setIsPublicDataMode(publicMode);
      if (publicMode) {
        setRange((prev) => (isIntradayRange(prev) ? '1m' : prev));
      }
      setValidatedStock((current) =>
        current?.symbol === stock.symbol && current.name === stock.name
          ? current
          : stock,
      );
      onProvenance?.({
        provider: info.provider,
        asOf: info.asOf,
        fallbackReason: info.fallbackReason,
      });
    },
    [onProvenance],
  );

  const onSelectWatchlistStock = (symbol: string): void => {
    if (symbol === requestedSymbol && validatedStock !== null) {
      return;
    }
    onSymbolSubmitted(symbol);
  };

  const onRemoveWatchlistStock = (symbol: string): void => {
    const next = removeFromWatchlist(watchlist, symbol);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const onToggleCurrentWatchlist = (): void => {
    if (!validatedStock) return;
    const next = watchlist.some((item) => item.symbol === validatedStock.symbol)
      ? removeFromWatchlist(watchlist, validatedStock.symbol)
      : addToWatchlist(watchlist, validatedStock);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const onToggleMa = (key: keyof MaVisibility): void => {
    setMaVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isCurrentInWatchlist =
    validatedStock !== null && watchlist.some((item) => item.symbol === validatedStock.symbol);

  return (
    <div className="stock-analysis-layout">
      <div className="focus-column">
        <div className="dashboard-card focus-card">
          {isPublicDataMode && (
            <div data-testid="public-data-banner" className="public-data-banner" role="status" aria-label="公開資料模式提示">
              <span className="public-data-banner-badge">公開資料模式</span>
              <span className="public-data-banner-text">
                報價來自 TWSE MIS，歷史 K 線來自交易所官方盤後日線。如需即時 5 分 K 與高頻盤中走勢，請配置 Fugle API Key。
              </span>
            </div>
          )}

          <StockQuotePanel
            requestedSymbol={requestedSymbol}
            searchSeq={searchSeq}
            onQuoteResolved={handleQuoteResolved}
            isInWatchlist={isCurrentInWatchlist}
            onToggleWatchlist={validatedStock !== null ? onToggleCurrentWatchlist : undefined}
          />

          {validatedStock === null ? (
            <div className="empty-analysis-state">
              <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.6 }}>
                輸入股票代號或從自選清單選擇股票
                <br />
                即可查看即時報價與近期走勢
              </p>
            </div>
          ) : (
            <StockHistoryFocus
              symbol={validatedStock.symbol}
              range={range}
              onRangeChange={setRange}
              maVisibility={maVisibility}
              onToggleMa={onToggleMa}
              disableIntradayRanges={isPublicDataMode}
            />
          )}
        </div>

        {validatedStock !== null && <StockHistoryTable symbol={validatedStock.symbol} range={range} />}
      </div>

      <aside className="watchlist-rail">
        <StockWatchlistPanel
          items={watchlist}
          activeSymbol={validatedStock?.symbol ?? requestedSymbol}
          onSelectStock={onSelectWatchlistStock}
          onRemoveStock={onRemoveWatchlistStock}
        />
      </aside>
    </div>
  );
}
