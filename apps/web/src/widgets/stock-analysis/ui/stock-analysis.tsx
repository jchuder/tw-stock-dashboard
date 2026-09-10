import { useQuery } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import type { JSX } from 'react';
import type { HistoryRange, Market, Security, StockQuoteBatchItem, StockQuoteProvider } from '@tw-stock-dashboard/contracts';
import { fetchSecurities } from '../../../entities/security/index.js';
import { StockHistoryFocus, StockHistoryTable } from '../../../features/stock-history/index.js';
import type { MaVisibility } from '../../../features/stock-history/ui/stock-history-chart.js';
import { fetchStockQuoteBatches, StockQuotePanel } from '../../../features/stock-quote/index.js';
import type { QuoteResolvedInfo } from '../../../features/stock-quote/index.js';
import {
  addToWatchlist,
  loadWatchlist,
  removeFromWatchlist,
  reorderWatchlist,
  saveWatchlist,
  StockWatchlistPanel,
} from '../../../features/stock-watchlist/index.js';
import type { WatchlistDisplayItem } from '../../../features/stock-watchlist/index.js';
import { getMarketOverviewRefetchInterval } from '../../../shared/datetime/format-taipei.js';

function isIntradayRange(range: HistoryRange): boolean {
  return range === '1d' || range === '3d' || range === '5d';
}

export function indexWatchlistQuotes(
  items: readonly StockQuoteBatchItem[],
): Readonly<Record<string, StockQuoteBatchItem>> {
  return Object.fromEntries(items.map((item) => [item.symbol, item]));
}

export function indexWatchlistSecurities(
  items: readonly Security[],
): Readonly<Record<string, Security>> {
  return Object.fromEntries(items.map((item) => [item.symbol, item]));
}

export function buildWatchlistItems(
  symbols: readonly string[],
  securities: Readonly<Record<string, Security>>,
): WatchlistDisplayItem[] {
  return symbols.map((symbol) => {
    const security = securities[symbol];
    return {
      symbol,
      name: security?.name ?? '—',
      market: security?.market ?? null,
    };
  });
}

export function hasRetryableWatchlistQuotes(items: readonly StockQuoteBatchItem[]): boolean {
  return items.some((item) => item.error === 'failed' || item.error === 'unavailable');
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
      provider: StockQuoteProvider;
      asOf: string | null;
      fallbackReason?: 'config_missing' | 'upstream_unavailable' | null;
    } | null,
  ) => void;
}): JSX.Element {
  const [watchlist, setWatchlist] = useState<string[]>(() => loadWatchlist());
  const watchlistSymbols = watchlist;
  const watchlistQuerySymbols = [...watchlistSymbols].sort();
  const watchlistQuoteQuery = useQuery({
    queryKey: ['watchlist-quotes', watchlistQuerySymbols],
    queryFn: () => fetchStockQuoteBatches(watchlistSymbols),
    enabled: watchlistSymbols.length > 0,
    // Same trading-window schedule as Market Overview: 30s polls intraday,
    // paused (wake at next 08:55) when closed to save upstream quota.
    refetchInterval: () => getMarketOverviewRefetchInterval(),
    staleTime: 10_000,
    retry: false,
  });
  const watchlistQuoteItems = watchlistQuoteQuery.data?.items ?? [];
  const watchlistQuotes = indexWatchlistQuotes(watchlistQuoteItems);
  const watchlistHasRetryableError =
    watchlistQuoteQuery.isError || hasRetryableWatchlistQuotes(watchlistQuoteItems);
  const watchlistSecurityQuery = useQuery({
    queryKey: ['watchlist-securities', watchlistQuerySymbols],
    queryFn: () => fetchSecurities(watchlistSymbols),
    enabled: watchlistSymbols.length > 0,
    staleTime: 300_000,
    retry: false,
  });
  const watchlistSecurities = indexWatchlistSecurities(watchlistSecurityQuery.data ?? []);
  const watchlistItems = buildWatchlistItems(watchlistSymbols, watchlistSecurities);
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
    const next = watchlist.includes(validatedStock.symbol)
      ? removeFromWatchlist(watchlist, validatedStock.symbol)
      : addToWatchlist(watchlist, validatedStock.symbol);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const onMoveWatchlistStock = (symbol: string, targetIndex: number): void => {
    const next = reorderWatchlist(watchlist, symbol, targetIndex);
    setWatchlist(next);
    saveWatchlist(next);
  };

  const onToggleMa = (key: keyof MaVisibility): void => {
    setMaVisibility((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const isCurrentInWatchlist =
    validatedStock !== null && watchlist.includes(validatedStock.symbol);
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
                  : '報價來自 TWSE / TPEx 官方公開收盤資料（盤後日線為主，尚未更新時以已收盤 MIS 資料補齊）；歷史 K 線使用交易所官方盤後日線。如需即時 5 分 K 與高頻盤中走勢，請設定 Fugle API Key。'}
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
          items={watchlistItems}
          quotes={watchlistQuotes}
          isLoading={watchlistQuoteQuery.isPending}
          isRefreshing={watchlistQuoteQuery.isFetching && !watchlistQuoteQuery.isPending}
          isError={watchlistHasRetryableError}
          onRetry={() => void watchlistQuoteQuery.refetch()}
          activeSymbol={validatedStock?.symbol ?? requestedSymbol}
          onSelectStock={onSelectWatchlistStock}
          onRemoveStock={onRemoveWatchlistStock}
          onMoveStock={onMoveWatchlistStock}
        />
      </aside>
    </div>
  );
}
