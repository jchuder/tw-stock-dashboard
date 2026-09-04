# ADR 002 — Vitest 5 + import resolver for boundaries

Date: 2026-09-05
Status: Accepted (updated after Phase 0 review: `@effect/vitest` deferred)

## Context

- Spec pins Vitest `5.0.0` and `@effect/vitest` `0.30.0`. Upstream `@effect/vitest@0.30.0`
  peer is `vitest@^3.2.0`, so installing both reports:
  `unmet peer vitest: Wanted ^3.2.0, Installed 5.0.0`.
- Phase 0 review verdict: **BLOCKED** on accepting that peer mismatch while no
  Effect-specific test exists — the only backend test (`GET /health`) never
  exercises `@effect/vitest`, so "tests pass" proves nothing about the
  incompatible pair. Downgrading Vitest to `4.1.11` was rejected for the same
  reason: no `it.effect` / TestClock usage exists yet to verify against.
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

- Keep Vitest `5.0.0` per spec. **Defer `@effect/vitest`**: removed from
  `apps/api` devDependencies until an Effect-specific testing requirement
  (e.g. `it.effect`, TestClock, Effect lifecycle) actually exists AND a
  compatible stable release is available. Plain `Effect.runPromise` covers
  ordinary Effect tests in the meantime — no helper justifies pinning an
  incompatible tester ahead of need. (Lazy ladder: don't install the helper
  before the requirement.)
- Add `eslint-import-resolver-typescript@4.4.5` (devDependency, root) and
  configure `settings['import/resolver'].typescript` in `eslint.config.mjs`.
  This is the minimal toolchain fix to make boundaries enforcement effective
  for `.js` ESM imports. `pnpm approve-builds` records `allowBuilds:
  unrs-resolver: true` in `pnpm-workspace.yaml` (required by pnpm 11).

## Consequences

- `pnpm peers check` is clean. `pnpm lint` / `pnpm test` / `pnpm test:e2e`
  remain green and are the gate.
- Boundaries now correctly blocks: `feature A → feature B`,
  `shared → feature`, `entity A → entity B`, `apps/web → apps/api`,
  `apps/api → apps/web`. All cross-app sharing must go via
  `packages/contracts`.
- Revisit `@effect/vitest` at the first slice that needs Effect-specific
  test helpers (earliest Q2 typed upstream failures); survey stable
  compatibility then instead of carrying a known-broken pair.
