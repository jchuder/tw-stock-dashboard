# ADR 006 — Market-aware history model and ESB average-price semantics

Date: 2026-09-07
Status: Accepted

## Context

The original dashboard model primarily assumed listed and OTC securities with
OHLC candles, close-based daily history, candlesticks, previous close, and
`MA(close)`.

Phase 0 confirmed that `7883 饗賓` is an ESB security. TPEx ESB official data
has different semantics:

- history has official high, low, and average values but no complete open/close
- the reference basis is previous average, not previous close
- ESB must not receive fabricated listed/OTC limit-up or limit-down prices
- zero no-trade sentinels are not real price zeroes

## Decision

Contracts remain market-aware instead of forcing every market into one fake OHLC
shape.

### Quote semantics

TWSE and TPEX quotes use:

```text
referencePriceType = previous_close
```

ESB quotes use:

```text
referencePriceType = previous_average
openPrice = null
limitUpPrice = null
limitDownPrice = null
```

For ESB current data:

- `LatestPrice = 0` normalizes to `price = null`.
- `Highest = 0` and `Lowest = 0` normalize to `null`.
- `TransactionVolume = 0` remains valid zero volume.
- If price or reference is `null`, `change` and `changePercent` are `null`.

### History semantics

TWSE and TPEX retain close-basis history:

```text
priceBasis = close
open/high/low/close = official values
average = null
MA = latest N valid close observations
UI = candlestick history
```

ESB history uses official average-basis data:

```text
priceBasis = average
open = null
close = null
high/low/average = official first-group values
MA = latest N valid average observations
UI = average-price line history
```

ESB volume is the sum of the first and second official groups. If first-group
volume is zero while second-group volume is positive, high, low, and average
remain `null`, volume is retained, and no price is inferred from the second
group.

The shared `Candle` contract may therefore contain nullable OHLC fields plus an
explicit `priceBasis: 'close' | 'average'`. Consumers must use `priceBasis` to
interpret the values.

### UI semantics

The UI must not manufacture fake OHLC or fake close values merely to make ESB
look like TWSE/TPEX. ESB history is presented as official daily average-price
history, not as `日 K` or a candlestick market structure.

ESB recent-history columns are:

```text
日期 / 最高價 / 最低價 / 平均價 / 成交量（股）
```

They must not be represented as `開盤 —` and `收盤 —` rows that imply the same
market structure as listed or OTC securities.

## Consequences

- Shared chart and table components can support multiple market semantics while
  preserving explicit nullability and basis metadata.
- Moving averages, reference prices, change calculations, and labels cannot be
  selected from a universal close assumption.
- New market integrations must document their price basis, no-trade sentinels,
  volume groups, and UI representation before reusing the shared contract.

## Alternatives considered

### Fabricate OHLC

Rejected: setting `open = average`, `close = average`, or similar values makes
charts, moving averages, and reference semantics look like real closing prices
when the provider did not supply them.

### Use one universal close-based model

Rejected: it hides different market microstructure behind an incorrect
abstraction and makes downstream calculations appear more comparable than they
are.

### Keep explicit market-aware semantics

Accepted: retain the shared `Candle` contract, allow nullable OHLC fields, and
require explicit `priceBasis` so every consumer knows how to interpret the data.
