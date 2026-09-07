import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { HistoryRange, Market, StockQuoteBatchItem } from '@tw-stock-dashboard/contracts';
import { StockHistoryFocus, StockHistoryTable } from '../../../features/stock-history/index.js';
import type { MaVisibility } from '../../../features/stock-history/ui/stock-history-chart.js';
import { fetchStockQuoteBatches, StockQuotePanel } from '../../../features/stock-quote/index.js';
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

export function indexWatchlistQuotes(
  items: readonly StockQuoteBatchItem[],
): Readonly<Record<string, StockQuoteBatchItem>> {
  return Object.fromEntries(items.map((item) => [item.symbol, item]));
}

export type HistoryDisabledReason = 'fugle-api-key' | 'esb-official-daily';

export interface QuoteHistoryMode {
  disableIntradayRanges: boolean;
  range: HistoryRange;
  disabledReason: HistoryDisabledReason | null;
}

export function resolveQuoteHistoryMode(
  range: HistoryRange,
  market: Market | null,
  fallbackReason: 'config_missing' | 'upstream_unavailable' | null | undefined,
): QuoteHistoryMode {
  const isEsb = market === 'ESB';
  const isPublicDataMode = fallbackReason === 'config_missing';
  const disableIntradayRanges = isEsb || isPublicDataMode;
  return {
    disableIntradayRanges,
    range: disableIntradayRanges && isIntradayRange(range) ? '1m' : range,
    disabledReason: isEsb ? 'esb-official-daily' : isPublicDataMode ? 'fugle-api-key' : null,
  };
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
  const watchlistSymbols = watchlist.map((item) => item.symbol);
  const watchlistQuoteQuery = useQuery({
    queryKey: ['watchlist-quotes', watchlistSymbols],
    queryFn: () => fetchStockQuoteBatches(watchlistSymbols),
    enabled: watchlistSymbols.length > 0,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: false,
  });
  const watchlistQuotes = indexWatchlistQuotes(watchlistQuoteQuery.data?.items ?? []);
  const [validatedStock, setValidatedStock] = useState<{ symbol: string; name: string } | null>(
    null,
  );
  const [validatedMarket, setValidatedMarket] = useState<Market | null>(null);
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
      setValidatedMarket(null);
      setIsPublicDataMode(false);
      onProvenance?.(null);
    }
  }, [requestedSymbol, validatedStock?.symbol, onProvenance]);

  const handleQuoteResolved = useCallback(
    (stock: { symbol: string; name: string; market: Market }, info: QuoteResolvedInfo): void => {
      const publicMode = info.fallbackReason === 'config_missing';
      setIsPublicDataMode(publicMode);
      setValidatedMarket(stock.market);
      setRange((currentRange) =>
        resolveQuoteHistoryMode(currentRange, stock.market, info.fallbackReason).range,
      );
      setValidatedStock((current) =>
        current?.symbol === stock.symbol && current.name === stock.name
          ? current
          : { symbol: stock.symbol, name: stock.name },
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
  const historyMode = resolveQuoteHistoryMode(
    range,
    validatedMarket,
    isPublicDataMode ? 'config_missing' : null,
  );

  return (
    <div className="stock-analysis-layout">
      <div className="focus-column">
        <div className="dashboard-card focus-card">
          {(isPublicDataMode || validatedMarket === 'ESB') && (
            <div data-testid="public-data-banner" className="public-data-banner" role="status" aria-label="公開資料模式提示">
              <span className="public-data-banner-badge">公開資料模式</span>
              <span className="public-data-banner-text">
                {validatedMarket === 'ESB'
                  ? '報價來自 TPEx 興櫃官方公開資料；目前提供官方日均價歷史走勢，暫不提供 5 分 K。'
                  : '報價來自 TWSE MIS，歷史 K 線來自交易所官方盤後日線。如需即時 5 分 K 與高頻盤中走勢，請配置 Fugle API Key。'}
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
              disableIntradayRanges={historyMode.disableIntradayRanges}
              intradayDisabledReason={historyMode.disabledReason}
            />
          )}
        </div>

        {validatedStock !== null && <StockHistoryTable symbol={validatedStock.symbol} range={range} />}
      </div>

      <aside className="watchlist-rail">
        <StockWatchlistPanel
          items={watchlist}
          quotes={watchlistQuotes}
          isLoading={watchlistQuoteQuery.isPending}
          isRefreshing={watchlistQuoteQuery.isFetching && !watchlistQuoteQuery.isPending}
          isError={watchlistQuoteQuery.isError}
          onRetry={() => void watchlistQuoteQuery.refetch()}
          activeSymbol={validatedStock?.symbol ?? requestedSymbol}
          onSelectStock={onSelectWatchlistStock}
          onRemoveStock={onRemoveWatchlistStock}
        />
      </aside>
    </div>
  );
}
