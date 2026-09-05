import { useEffect, useRef } from 'react';
import type { JSX } from 'react';
import { CandlestickSeries, HistogramSeries, createChart } from 'lightweight-charts';
import type { ISeriesApi } from 'lightweight-charts';
import type { Candle } from '@tw-stock-dashboard/contracts';

// Taiwan market convention: up is red, down is green. Kept as plain
// component constants — no theme system until a second theme exists.
const UP_COLOR = '#f23645';
const DOWN_COLOR = '#089981';
const UP_VOLUME_COLOR = 'rgba(242, 54, 69, 0.5)';
const DOWN_VOLUME_COLOR = 'rgba(8, 153, 129, 0.5)';

export function StockHistoryChart({ candles }: { candles: ReadonlyArray<Candle> }): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
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
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.1, bottom: 0.25 } });
    volumeSeries.priceScale().applyOptions({ scaleMargins: { top: 0.75, bottom: 0 } });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;
    return () => {
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!chart || !candleSeries || !volumeSeries) {
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
    chart.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} data-testid="stock-history-chart" style={{ height: 320 }} />;
}
