# ADR 008 — Redis is mandatory shared market-data coordination infrastructure

Date: 2026-09-11
Status: Proposed

## Context

Market-data workflows fan out to metered upstreams (Fugle intraday 60/min on the
basic plan) and heavy official endpoints (`STOCK_DAY_ALL`, `MI_INDEX`). The
frontend polls on a 30-second trading-window schedule from every open tab, and
deployments may run several API instances. The current per-process caches
(`StockQuoteCache` 5-second `Map`, process-local provider singleflights) cannot
deduplicate across tabs that miss in different 5-second phases, let alone across
instances. Each miss costs 2 Fugle calls (intraday quote + ticker), and cold
bursts scale with tab and instance count.

ADR 005 deliberately made Redis fail-open and not a correctness dependency. That
decision assumed Redis was a latency optimization. Once Redis is expected to
coordinate quota usage, a Redis outage that silently bypasses to direct upstream
calls manufactures exactly the stampede the cache exists to prevent. This ADR
therefore reverses the core decision of ADR 005 (which will be marked Superseded
only after the implementation below lands and passes all gates).

## Decision

Redis is a mandatory runtime dependency and the shared freshness/quota
coordination authority for market-data workflows.

- Missing `REDIS_URL` fails API startup. A failed startup `connect`/`PING`
  fails API startup. The process must not finish listening while Redis is
  unverified.
- Liveness (`GET /health`) reports process aliveness only and never checks
  Redis. Readiness (`GET /health/ready`) returns `200` only when Redis `PING`
  succeeds and `503` otherwise, so orchestrators stop routing market-data
  traffic without mistaking a Redis incident for a dead process.
- At runtime, a Redis-dependent market-data workflow whose coordination is
  unavailable fails closed with `503`. It must not bypass Redis and call the
  metered upstream directly.
- Redis is the freshness/quota coordination authority. Redis is not the market
  price source of truth: Fugle, TWSE, and TPEx remain the only data sources.
  Redis records whether a freshness window has already been refreshed, never
  what the market price is.
- Freshness is decided by `windowId` stored in the cached envelope, never by
  Redis key TTL. TTL exists only for garbage collection (roughly 3× the window).
- No process-local (L1) quote cache. One shared snapshot per resource per
  window is the only snapshot; a second cache layer would reintroduce
  cross-instance inconsistency for the price of one saved `GET`.
- Distributed refresh ownership uses a stable per-resource lock key (never
  per-window, to survive boundary races) with a unique token via
  `SET key token NX PX`. Lock TTL covers one refresh operation (10 seconds for
  quote workflows: two 3-second upstream budgets plus fallback margin), never
  the freshness duration. Release must compare token ownership (Lua
  compare-and-delete); a plain `DEL` can delete a successor's lock.
- Followers never call the upstream on a miss. They short-poll Redis
  (100 ms ± 25 ms jitter, 10.5-second deadline, then
  `WindowCoordinationTimeoutError` → `503`). An expired lock with no fresh
  snapshot means followers compete to become the new leader; no election
  protocol is needed.
- A snapshot is stamped with the window containing its upstream completion
  time, not its request start time, so followers arriving just after a boundary
  can reuse a refresh that finished across it.
- Cache infrastructure failures keep their own typed errors
  (`RedisCommandError`, `RedisConnectionError`, `WindowCoordinationTimeoutError`,
  `StockHistoryCacheError`, `TpexEsbCacheError`) and map to `503` at HTTP boundaries.
  In the universe subsystem, cache and provider coordination failures normalize into
  `UniverseUnavailableError` (`503`) to signal total catalog unavailability while
  genuine defects still escape. Corrupt envelopes are invalidated and treated as
  misses; provider/schema failures still never poison the cache.
- Each market-data resource defines its own freshness window; there is no
  single global interval. The mechanism (window cache + distributed lock) is
  shared, the policy (window length, snapshot TTL, lock/follower parameters) is
  per resource.

## Consequences

- Every tab and every API instance sharing one Redis converges on at most one
  upstream refresh per resource per window. Upstream call volume stops scaling
  with client or instance count.
- A Redis incident becomes a market-data incident (`503` on affected
  workflows) instead of a silent quota stampede. This is intentional and
  replaces the ADR 005 fail-open guarantee.
- Local development, CI, and Docker environments must all provision Redis;
  `.env.example`, compose, and CI services are updated and `REDIS_URL` may no
  longer be documented as optional.
- `StockQuoteCache` keeps its feature abstraction name but becomes a
  Redis-backed window policy; its internal `Map` is deleted. The generic
  `CacheService` keeps JSON primitives only and gains typed infrastructure
  errors; the lazy nullable `getRedisClient()` shape is replaced by a
  Nest-managed `RedisService` that connects and `PING`s during module init.
- The existing `getRedisClient(): RedisClientType | null` fail-open API is
  removed with this change; no caller may retain a bypass path for
  quota-controlled workflows.

## Alternatives considered

### A. Keep Redis fail-open and add process-local singleflight only

Rejected: singleflight collapses only same-process races. Staggered tabs and
additional instances still multiply upstream calls, which is the observed quota
risk. It also preserves two freshness authorities (process TTL vs Redis TTL).

### B. L1 process cache in front of shared Redis

Rejected: marginal savings (one `GET`) against reintroduced cross-instance
inconsistency, rollover invalidation, and dual provenance. Revisit only with
measured Redis latency evidence.

### C. Server-scheduled fan-out with an active-symbol registry

Rejected for now: requires answering which symbols to prefetch, how the active
set survives restarts, and how refresh failures are handled. Request-driven
window cache with distributed singleflight covers single-user and demo scale.
Revisit with real multi-user evidence.

### D. Fugle WebSocket instead of polling

Rejected for now: the basic plan allows 5 subscriptions on 1 connection while a
typical watchlist already exceeds that. Revisit on a paid plan.
