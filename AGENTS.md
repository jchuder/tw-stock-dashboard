# AGENTS.md

## Architecture

- Use feature-first architecture. Dependency direction: `shared → entities → features → widgets → app`.
- Do not introduce a layer or abstraction before a concrete use case requires it.
- Features must not import other features. Shared code must not know product domain.
- Prefer vertical slices over horizontal layer-first implementation.
- Cross-app imports are forbidden: `apps/api` and `apps/web` share code only via `packages/contracts`.
- Boundaries are enforced by ESLint (`eslint-plugin-boundaries`), not by convention alone.

## Effect

- NestJS owns HTTP/bootstrap/DI boundaries.
- Effect owns workflows involving async effects, typed failures, timeout, retry, fallback and concurrency.
- Do not introduce Effect Context/Layer unless a concrete requirement demonstrates value.

## Testing

- Acceptance criteria are defined before feature implementation.
- Integration tests are the primary backend safety net.
- Do not call real market-data services in deterministic tests.
- Live provider tests must be explicitly opt-in.

## Dependencies

- Use latest LTS where an official LTS channel exists. Otherwise use latest stable.
- No alpha/beta/RC/canary/next dependencies.
- Peer-compatibility downgrades require an ADR or code comment explaining why.
- Commit messages follow the global `commit` skill: semantic type, imperative English subject, ≤100-character header.

## Git Workflow

- `main` is release-controlled. Merge `dev` into `main` only when the user explicitly decides to release.
- Start all development from `dev` on a focused branch named by the global `git-branch-naming` skill.
- Complete acceptance, review, and verification on the feature branch, then merge it into `dev`.
- Keep unrelated work in separate feature branches and commits.

## Scope

- Do not add database, authentication, Redis, queues, WebSockets or deployment infrastructure without an approved requirement.

## Observability

- Never log secrets.
- FUGLE_API_KEY and authorization credentials must always be redacted.
- When diagnosing runtime failures:
  1. Inspect the relevant deterministic tests.
  2. Query SigNoz logs and traces when telemetry is available.
  3. Correlate by request_id and trace_id.
  4. Identify the failing boundary before changing code.
  5. Do not infer an upstream failure when telemetry can verify it.
  6. After a fix, rerun the relevant tests and verify telemetry if the failure was runtime-only.
