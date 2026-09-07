# ADR 005 — Redis is a fail-open cache, not a correctness dependency

Date: 2026-09-07
Status: Accepted

## Context

Redis reduces latency and upstream request volume, but official market-data
providers remain the source of truth. The dashboard must remain usable after a
fresh clone, with `REDIS_URL` absent, or while Redis is temporarily unavailable.
Making Redis mandatory would turn a cache outage into a market-data outage.

## Decision

Redis is a performance and upstream-load cache only. It is not a correctness
authority and must not be a business workflow dependency.

- Missing `REDIS_URL` disables the cache; the application continues normally.
- Redis connect, `get`, `set`, and `delete` failures warn, bypass the cache, and
  continue the business workflow.
- Redis being down must not make quote, history, or universe APIs return `500`.
  The API fails only when the business upstream or domain workflow itself fails.

Current cache keys and policies include:

```text
security-universe:v1       24h
security-universe:lkg:v1    7d

history:twse:{symbol}:{YYYYMM}
history:tpex:{symbol}:{YYYYMM}
history:esb:{symbol}:{YYYYMM}
```

For monthly history, the current Taipei month uses a `5m` TTL and a closed
historical month uses a `24h` TTL.

Cache payloads must be schema-validated before use. Invalid payloads are cache
misses, not valid data. Provider or schema failures must not poison the cache.
A partial universe result must not overwrite an authoritative complete canonical
cache.

Quote and ESB snapshot caching is not assumed to be implemented by this ADR.
If added later, it must follow the same fail-open and validation policy.

## Consequences

- Demo and development environments work without optional Redis infrastructure.
- A Redis outage increases provider traffic and may increase latency, but does
  not manufacture a market-data outage.
- Cache code must preserve clear miss, bypass, invalid-payload, and upstream
  failure paths; it cannot silently promote cached data to correctness authority.

## Alternatives considered

### A. Make Redis mandatory infrastructure

Rejected: a blank optional-infrastructure environment would fail to start or
serve market data even though the official providers are available.

### B. Make Redis failure fail `/health` and business APIs

Rejected: cache availability is not business availability. This would expand a
cache incident into an unnecessary API outage.

### C. Treat Redis contents as the correctness authority

Rejected: cached data can be stale or invalid. Provider data and validated
market-domain contracts determine correctness; Redis only accelerates access.
