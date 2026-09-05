# tw-stock-dashboard

Taiwan Stock Dashboard. Phase 0: project foundation — infrastructure tracer bullet only, no stock domain yet.

## Topology

```text
apps/api            NestJS 12 API (GET /health)
apps/web            React 19 + Vite 8 frontend
packages/contracts  Shared API contracts (health only for now)
e2e/                Playwright acceptance specs
```

## Prerequisites

Node.js 24.20.0 LTS, pnpm 11.25.0 (`packageManager` + `engines` enforce this).

## Scripts

| Command           | What                                   |
| ----------------- | -------------------------------------- |
| `pnpm dev:api`    | API dev server (`http://localhost:3001`) |
| `pnpm dev:web`    | Web dev server (`http://localhost:5173`) |
| `pnpm build`      | Build all workspaces                   |
| `pnpm lint`       | ESLint incl. architecture boundaries   |
| `pnpm typecheck`  | Build then typecheck all workspaces    |
| `pnpm test`       | Build then run all workspace tests     |
| `pnpm test:e2e`   | Build then run Playwright acceptance   |

## Configuration

API logging defaults to `LOG_LEVEL=info` (JSON lines on stdout). Set `LOG_LEVEL`
to `debug`, `warn`, or `error` to change verbosity. No config framework involved.

To export OpenTelemetry traces/logs to self-hosted SigNoz, run the API via
`pnpm --filter @tw-stock-dashboard/api start:otel` with:

```bash
OTEL_EXPORTER_OTLP_ENDPOINT=http://<popos-host>:4318
OTEL_SERVICE_NAME=tw-stock-dashboard-api
OTEL_DEPLOYMENT_ENV=development
```

Self-hosted SigNoz needs no ingestion key, so `OTEL_EXPORTER_OTLP_HEADERS` stays
unset. Never hardcode a host into the repo.

## Version policy

Latest LTS where an official LTS channel exists, otherwise latest stable. No pre-release
dependencies. Peer-compatibility downgrades require an ADR or comment.
