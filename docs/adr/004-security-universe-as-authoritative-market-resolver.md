# ADR 004 — Security Universe as authoritative market resolver

Date: 2026-09-07
Status: Accepted

## Context

Quote and history features need one consistent answer for whether a symbol exists,
what it is called, which market it belongs to, and what kind of security it is.
Those facts cannot be inferred reliably by probing quote or history providers:
provider no-data may mean an unsupported endpoint, an upstream failure, or a
security that does not exist.

The current target scope is:

- TWSE listed common stock
- TPEX OTC common stock
- ESB common stock
- TWSE ETF
- TPEX ETF

## Decision

Security Universe is the authoritative source for symbol existence, security
name, market, and security type. Its domain shape is:

```ts
interface Security {
  symbol: string
  name: string
  market: 'TWSE' | 'TPEX' | 'ESB'
  type: 'stock' | 'etf'
}
```

Routing must resolve identity before selecting a provider:

```text
symbol → UniverseResolver → Security → market-aware provider
```

The market mapping is explicit:

- `TWSE` → TWSE provider
- `TPEX` → TPEx provider
- `ESB` → TPEx ESB provider

Quote and history providers must not independently probe upstream endpoints to
guess market or symbol existence.

Resolution completeness has explicit semantics:

- If any successful required universe source finds the symbol, resolution
  succeeds.
- If all required sources succeed and all miss, return `404 StockNotFound`.
- If all sources miss and any required source fails, return
  `503 UniverseUnavailable`.
- A partial fresh result plus a valid LKG may resolve known merged positives.
  LKG does not mean the current universe is complete; an unknown symbol remains
  `503 UniverseUnavailable`, never a fabricated `404`.
- Only a fully successful fresh rebuild or a valid complete canonical cache may
  make an unknown symbol reliably resolve to `404 StockNotFound`.

## Consequences

- Every market-data workflow receives an explicit `Security` before provider
  I/O, so market routing and existence semantics do not drift between features.
- `StockNotFound` and `UniverseUnavailable` remain distinguishable to API
  consumers and operators.
- Adding a market or security type requires updating the universe contract and
  routing map rather than adding another provider probe.

## Alternatives considered

### A. Let each quote/history provider probe the market

Rejected: cross-market probing adds latency and upstream coupling, and different
features can disagree about market identity or symbol existence.

### B. Trust one official endpoint as the complete universe

Rejected: no single clean official source covers the complete target scope of
TWSE, TPEX, ESB, stocks, and ETFs.

### C. Treat upstream no-data as `StockNotFound`

Rejected: provider no-data does not prove that a security is absent. It may be a
provider limitation or upstream failure, causing false `404` responses.
