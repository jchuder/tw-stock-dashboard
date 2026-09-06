import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { CandlestickSeries, HistogramSeries, LineSeries, createChart } from 'lightweight-charts';
import type { ISeriesApi } from 'lightweight-charts';
import type { Candle } from '@tw-stock-dashboard/contracts';

// Taiwan market convention: up is red, down is green. Kept as plain
// component constants — no theme system until a second theme exists.
const UP_COLOR = '#f23645';
const DOWN_COLOR = '#089981';
const UP_VOLUME_COLOR = 'rgba(242, 54, 69, 0.5)';
const DOWN_VOLUME_COLOR = 'rgba(8, 153, 129, 0.5)';

// Component-level color constants for simple moving average lines.
const MA5_COLOR = '#ff9800';
const MA10_COLOR = '#2196f3';
const MA20_COLOR = '#9c27b0';
const MA60_COLOR = '#4caf50';

export interface MaVisibility {
  ma5: boolean;
  ma10: boolean;
  ma20: boolean;
  ma60: boolean;
}

const DEFAULT_MA_VISIBILITY: MaVisibility = {
  ma5: true,
  ma10: true,
  ma20: true,
  ma60: true,
};

export function StockHistoryChart({
  candles,
  maVisibility = DEFAULT_MA_VISIBILITY,
}: {
  candles: ReadonlyArray<Candle>;
  maVisibility?: MaVisibility;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ma5SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma10SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma20SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const ma60SeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }
    const chart = createChart(container, { autoSize: true });
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: UP_COLOR,
      downColor: DOWN_COLOR,
      wickUpColor: UP_COLOR,
      wickDownColor: DOWN_COLOR,
      borderUpColor: UP_COLOR,
      borderDownColor: DOWN_COLOR,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: '',
    });
    const ma5Series = chart.addSeries(LineSeries, {
      color: MA5_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ma10Series = chart.addSeries(LineSeries, {
      color: MA10_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ma20Series = chart.addSeries(LineSeries, {
      color: MA20_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });
    const ma60Series = chart.addSeries(LineSeries, {
      color: MA60_COLOR,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    ma5SeriesRef.current = ma5Series;
    ma10SeriesRef.current = ma10Series;
    ma20SeriesRef.current = ma20Series;
    ma60SeriesRef.current = ma60Series;

    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ma5SeriesRef.current = null;
      ma10SeriesRef.current = null;
      ma20SeriesRef.current = null;
      ma60SeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    const ma5Series = ma5SeriesRef.current;
    const ma10Series = ma10SeriesRef.current;
    const ma20Series = ma20SeriesRef.current;
    const ma60Series = ma60SeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries || !ma5Series || !ma10Series || !ma20Series || !ma60Series) {
      return;
    }
    candleSeries.setData(
      candles.map((candle) => ({
        time: candle.date,
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
      })),
    );
    volumeSeries.setData(
      candles.map((candle) => ({
        time: candle.date,
        value: candle.volume,
        color: candle.close >= candle.open ? UP_VOLUME_COLOR : DOWN_VOLUME_COLOR,
      })),
    );
    ma5Series.setData(
      candles
        .filter((c): c is typeof c & { ma5: number } => c.ma5 !== null)
        .map((c) => ({ time: c.date, value: c.ma5 })),
    );
    ma10Series.setData(
      candles
        .filter((c): c is typeof c & { ma10: number } => c.ma10 !== null)
        .map((c) => ({ time: c.date, value: c.ma10 })),
    );
    ma20Series.setData(
      candles
        .filter((c): c is typeof c & { ma20: number } => c.ma20 !== null)
        .map((c) => ({ time: c.date, value: c.ma20 })),
    );
    ma60Series.setData(
      candles
        .filter((c): c is typeof c & { ma60: number } => c.ma60 !== null)
        .map((c) => ({ time: c.date, value: c.ma60 })),
    );
    chart.timeScale().fitContent();
  }, [candles]);

  useEffect(() => {
    ma5SeriesRef.current?.applyOptions({ visible: maVisibility.ma5 });
    ma10SeriesRef.current?.applyOptions({ visible: maVisibility.ma10 });
    ma20SeriesRef.current?.applyOptions({ visible: maVisibility.ma20 });
    ma60SeriesRef.current?.applyOptions({ visible: maVisibility.ma60 });
  }, [maVisibility]);

  return (
    <div>
      <div ref={containerRef} data-testid="stock-history-chart" className="chart-wrapper" />
      <p style={{ fontSize: '0.75rem', color: '#94a3b8', margin: '8px 0 0' }}>
        TradingView Lightweight Charts™
        <br />
        Copyright © 2025 TradingView, Inc.
      </p>
    </div>
  );
}
