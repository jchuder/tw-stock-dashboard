# ADR 001 — TypeScript Downgrade 7.0.2 → 6.0.3

Date: 2026-09-05
Status: Accepted

## Context

Spec pins TypeScript 7.0.2 (latest stable as of 2026-09-05). Two toolchain peers do not yet support the TS 7 programmatic API:

- `@nestjs/cli@12.0.0` depends on `typescript@~6.0.2` and explicitly rejects 7.0 (`UNSUPPORTED_TYPESCRIPT_VERSION`). Error: `TypeScript 7.0 ships the "tsc" executable only; the compiler API is expected to return in 7.1`.
- `typescript-eslint@8.69.0` peer range `>=4.8.4 <6.1.0` — 7.0.2 is out of range (reported by `pnpm peers check`).

## Decision

Pin TypeScript to `6.0.3` (latest 6.0 patch, satisfies both peers) across all workspaces (`package.json`, `apps/*`, `packages/*`). This is the minimal downgrade that makes `pnpm lint` and `pnpm build` green.

## Consequences

- Keeps Nest CLI `nest build` and `nest start --watch` without custom `tsc` workarounds.
- Keeps `typescript-eslint` peer satisfied; `pnpm peers check` no longer warns about TS.
- Revisit when Nest CLI and typescript-eslint publish TS 7 support (expected TS 7.1 per Nest error message). Then bump back to `7.x` and delete this ADR.
