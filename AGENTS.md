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
- Commit message: semantic prefix, present tense, English, ≤100 chars.

## Scope

- Do not add database, authentication, Redis, queues, WebSockets or deployment infrastructure without an approved requirement.

## Observability

- Never log secrets.
- FUGLE_API_KEY and authorization credentials must always be redacted.
