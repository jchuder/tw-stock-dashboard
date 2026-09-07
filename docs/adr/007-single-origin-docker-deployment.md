# ADR 007 — Single-origin Docker deployment

Date: 2026-09-08
Status: Accepted

## Context

The demo needs a reproducible production-like runtime that a reviewer can start
without installing the application toolchain locally. The browser should not
know or directly access the internal API host. Redis improves latency and
reduces upstream load, but it must remain a fail-open performance cache rather
than a correctness dependency. OpenTelemetry and SigNoz are external,
optional infrastructure.

## Decision

Docker Compose runs three services:

```text
web   Nginx static frontend and reverse proxy
api   Node 24 NestJS API
redis Redis 7 cache
```

The `web` image serves the built React/Vite bundle. Nginx proxies:

```text
/api/*  -> api:3001
/health -> api:3001/health
```

The browser therefore uses same-origin `/api` and `/health` requests. The API
and Redis services remain on the internal Compose network; only Nginx publishes
the browser-facing host port. The host port is configurable with `WEB_PORT` and
defaults to `8088`.

The API production container uses the Node 24 runtime and starts with the
existing OpenTelemetry bootstrap:

```text
--experimental-loader=@opentelemetry/instrumentation/hook.mjs
--import ./otel-register.mjs
```

Compose supplies Redis as `redis://redis:6379`. Redis remains fail-open at the
application level: missing or unavailable Redis bypasses the cache without
changing business correctness. The SigNoz / OTLP collector remains external
and optional; blank or unreachable OTLP configuration must not prevent the API
from becoming healthy.

## Consequences

- Docker users need Docker Desktop or Docker Engine with Docker Compose v2,
  rather than local Node, pnpm, Redis, or Nginx installations.
- Native local development remains available for contributors who need
  hot-reload workflows.
- Same-origin routing removes browser-side API-host configuration and avoids
  the corresponding CORS setup for the demo path.
- The topology is production-like and reproducible, but it is still a demo
  topology: it does not provide full high-availability, orchestration, secret
  management, or distributed scaling.
- This decision does not imply a distributed Redis lock or distributed ESB
  singleflight architecture. ESB refresh coalescing remains process-local,
  while Redis provides the shared validated snapshot cache.

## Alternatives considered

### Expose the API directly to the browser

Rejected: it requires browser-visible API host configuration and adds an
unnecessary cross-origin boundary to the single-host demo.

### Require native Node, Redis, and Nginx for the demo path

Rejected: it creates avoidable setup drift and makes the reproducible runtime
dependent on host-installed services.

### Treat Redis as required infrastructure

Rejected: Redis is a performance cache; an outage must not become a market-data
outage. See ADR 005 for the fail-open cache policy.
