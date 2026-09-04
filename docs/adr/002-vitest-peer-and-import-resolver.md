# ADR 002 — Vitest 5 Peer + import resolver for boundaries

Date: 2026-09-05
Status: Accepted

## Context

- Spec pins Vitest `5.0.0` and `@effect/vitest` `0.30.0`. Upstream `@effect/vitest@0.30.0`
  peer is `vitest@^3.2.0`, so `pnpm peers check` reports:
  `unmet peer vitest: Wanted ^3.2.0, Installed 5.0.0`.
  Functional verification (`pnpm test` passes, 1/1) shows `vitest@5` works with
  `@effect/vitest@0.30.0` despite the stale peer range. Downgrading Vitest to
  `3.x` would silence the peer but violate the spec's pinned `5.0.0`.

- `eslint-plugin-boundaries` uses `eslint-module-utils/resolve` to map
  dependency sources to element paths. TypeScript ESM imports in `apps/web`
  use `.js` extensions (e.g. `from '../shared/api/health.js'` → `health.ts`
  with `moduleResolution: Bundler`). Without a TypeScript-aware resolver,
  those imports resolve to `unknown` and the `default: disallow` gate is
  silently bypassed (debug shows `to: isUnknown true`). Adding
  `eslint-import-resolver-typescript` with `alwaysTryTypes: true` makes
  `*.js` → `*.ts` resolution work and restores the feature/entity/cross-app
  blocks. Verified: `feature beta → alpha` and `shared → feature` now
  correctly error.

## Decision

- Keep Vitest `5.0.0` per spec; treat the `@effect/vitest` peer warning as
  known and non-blocking. Revisit when `@effect/vitest` publishes a `5.x`
  peer.
- Add `eslint-import-resolver-typescript@4.4.5` (devDependency, root) and
  configure `settings['import/resolver'].typescript` in `eslint.config.mjs`.
  This is the minimal toolchain fix to make boundaries enforcement effective
  for `.js` ESM imports. `pnpm approve-builds` records `allowBuilds:
  unrs-resolver: true` in `pnpm-workspace.yaml` (required by pnpm 11).

## Consequences

- `pnpm peers check` will continue to warn about `@effect/vitest` until
  upstream updates its peer. `pnpm lint` / `pnpm test` / `pnpm test:e2e`
  remain green and are the gate.
- Boundaries now correctly blocks: `feature A → feature B`,
  `shared → feature`, `entity A → entity B`, `apps/web → apps/api`,
  `apps/api → apps/web`. All cross-app sharing must go via
  `packages/contracts`.
