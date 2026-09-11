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

## Commits

- Commit messages follow the global `commit` skill: semantic type, imperative English subject, ≤100-character header.
- `commitlint.config.mjs` is the machine-readable commit grammar source of truth.
- Lefthook validates `commit-msg` locally; PR CI validates every commit in the PR range. Do not bypass either gate to land malformed history.
- Breaking public-contract commits require both `!` in the header and a `BREAKING CHANGE:` footer. Changesets do not replace this Git-history signal.

## Git Workflow

- `main` is release-controlled and must only change through a PR. Normal `dev → main` releases and `hotfix/* → main` production fixes use **Merge commit** only.
- Start all normal development from `dev` on a focused branch named by the global `git-branch-naming` skill; normal human/agent credentials must not direct-push `dev` or `main`.
- Complete acceptance, review, and verification on the feature branch, then enter `dev` through a PR using **Merge commit** only. The merge commit preserves the reviewed PR boundary; the commits inside the PR remain the logical implementation history.
- `release/versions` is bot-managed and returns to `dev` through a PR using **Merge commit** only; never add product work to it. Keep its PR open while `dev` is still accumulating work for the same release, and merge it only when explicitly preparing/finalizing that release candidate.
- Commit-history reconstruction is not an automatic PR-preparation step. Use the global `branch-commit-cleanup` skill only when the user explicitly requests cleanup or reconstruction of a specific branch's commits.
- Production hotfixes start from current `main` on `hotfix/*` and return to `main` through a PR using **Merge commit** only.
- After a hotfix PR merges, `.github/workflows/main-to-dev-sync.yml` performs the only intentional direct update to `dev`: a GitHub-App-authenticated clean `main → dev` back-merge after commitlint and deterministic quality gates pass.
- If the automated back-merge conflicts, do not auto-resolve it. Resolve on a dedicated sync branch and use a normal PR to `dev`; that PR also uses **Merge commit**.
- Keep unrelated work in separate feature branches and commits.

## Versioning

- For any releasable change, version decision, release preparation, or hotfix, follow `.agents/skills/release-versioning/SKILL.md`.
- `apps/api`, `apps/web`, and `packages/contracts` use independent SemVer stored in each workspace `package.json`.
- Normal feature/fix branches add Changesets but do not run `changeset version`; the `dev` automation maintains `release/versions`.
- The open `release/versions → dev` PR is a rolling preview of the current pending release plan, not a signal to merge immediately. As new Changesets enter `dev`, automation rebuilds that branch and updates the PR. Merge it only when preparing the release candidate that will subsequently go `dev → main`.
- A production hotfix from `main` must consume its Changeset and include final package/changelog bumps before the PR returns to `main`.
- Changesets may add a patch release for an internal dependent when a versioned workspace dependency changes; do not undo that by manually editing package versions.
- Never publish the private workspace packages to npm through the release workflow.

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
