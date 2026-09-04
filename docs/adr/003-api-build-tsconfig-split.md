# ADR 003 — API production tsconfig split

Date: 2026-09-05
Status: Accepted

## Context

Phase 0 review (P1, non-blocking): production `nest build` used `tsconfig.json`,
which includes both `src/` and integration `test/`. Output landed at
`dist/src/main.js`, leaking test topology into the production artifact path
(`start`, Playwright webServer, future Docker all had to know it).

Splitting exposed a latent accident: `src/main.ts` uses `process.env`, but
`@types/node` was never a declared dependency. The old build only passed
because `test/` pulled `@types/supertest`, which transitively loaded node
globals. The `src`-only program lost that accident and failed with TS2591.

## Decision

- Add `apps/api/tsconfig.build.json` (`extends tsconfig.json`,
  `rootDir: src`, excludes `test` / `*.spec.ts`). `nest build` picks it up
  automatically; production entry is back to the boring `dist/main.js`.
- Declare `@types/node@24` (matches Node 24 runtime) in `apps/api`
  devDependencies and set `"types": ["node"]` in `tsconfig.json`, so node
  globals resolve deterministically in both build and typecheck programs
  instead of via test-file transitive luck.
- Point `apps/api start` and Playwright webServer at `dist/main.js`.

## Consequences

- `start`, e2e webServer, and any future packaging consume the standard
  Nest layout. `test/` stays in `tsconfig.json` for vitest + typecheck.
