---
name: release-versioning
description: Manage independent workspace SemVer, Changesets, normal releases, and production hotfix releases for tw-stock-dashboard. Use for any releasable change, version decision, release preparation, or hotfix.
---

# Release Versioning

Use Changesets as the release-intent source of truth. Conventional Commits remain the Git-history convention; they do not determine package bumps automatically. Commitlint/Lefthook/PR CI enforce deterministic commit structure separately.

## Versioned packages

- `apps/api` → `@tw-stock-dashboard/api`
- `apps/web` → `@tw-stock-dashboard/web`
- `packages/contracts` → `@tw-stock-dashboard/contracts`

All three packages are private but independently versioned and tagged. Never force their versions to match unless a future requirement explicitly introduces a Changesets `fixed` group.

## Decide the bump per affected package

- `patch`: backward-compatible bug fix or behavior correction.
- `minor`: backward-compatible capability or public surface addition.
- `major`: backward-incompatible public/API/contract behavior that requires consumer migration.
- A single implementation can have different bump levels for different packages.
- Do not add a bump for a package merely because it was touched by tests, formatting, documentation, or an implementation detail with no releasable behavior change.
- Changesets may add a `patch` bump to an internal dependent when one of its versioned workspace dependencies changes. Accept that generated dependent bump unless the release plan reveals a real modeling error.

The global commit skill still requires `!` plus a `BREAKING CHANGE:` footer for a backward-incompatible public contract commit. A Changeset `major` bump is release metadata and does not replace that commit rule.

## Normal development flow

1. Start from `dev` on a focused feature/fix branch.
2. Implement and verify the change.
3. If the change is releasable, run `pnpm changeset` and select every directly affected package with its independent bump level.
4. Write a user-facing summary describing observable behavior or migration impact.
5. Commit the generated `.changeset/*.md` with the implementation it describes.
6. Do **not** run `pnpm version:packages` on a normal feature branch.
7. Open a PR to `dev`. PR CI must pass `pr-commitlint` and `pr-quality`; merge into `dev` using **Merge commit** only so the reviewed PR boundary remains visible while logical commits are preserved inside it.
8. `.github/workflows/version-packages.yml` regenerates the App-owned `release/versions` PR from all pending Changesets and required internal-dependent bumps.
9. Treat the open `release/versions → dev` PR as a rolling release-plan preview. While more work for the same release is still entering `dev`, leave it open; each new `dev` push with pending Changesets rebuilds `release/versions` from the latest `dev` and updates the PR.
10. Only when explicitly preparing/finalizing the next release candidate, review and **Merge commit** `release/versions → dev`. This consumes the pending Changesets into package versions and changelogs on `dev`.
11. After that version PR is merged and the release candidate is approved, open a `dev → main` release PR. `main` requires `pr-commitlint`, `pr-quality`, `pr-e2e` and an up-to-date branch; merge the release PR using **Merge commit** only.
12. When workspace package versions change on `main`, `.github/workflows/release-tags.yml` creates and pushes only those package tags.

Do not merge a Version Packages PR merely because automation opened or refreshed it. Its existence means "this is what the next release would be if frozen now," not "release now."

Commit-history cleanup is not a release prerequisite and must never be inferred from PR preparation. If the user explicitly asks to reconstruct a branch into clean logical commits, use the global `branch-commit-cleanup` skill before the PR workflow; otherwise preserve the branch history as-is.

## Production hotfix flow

Use this only when the fix must ship before the next normal `dev` release.

1. Start `hotfix/*` from current `main`, not `dev`.
2. Implement and verify the smallest safe fix.
3. Run `pnpm changeset`; choose package bumps from actual compatibility impact.
4. Before opening the PR to `main`, run:
   - `pnpm changeset status --since main`
   - `pnpm version:packages`
   - `pnpm install --lockfile-only`
5. Review the generated package versions, changelogs and lockfile. The hotfix PR to `main` must already contain its final version bump because normal Version Packages automation runs on `dev`, not `main`.
6. Open `hotfix/* → main`; `pr-commitlint`, `pr-quality`, `pr-e2e` and the main Strict up-to-date policy must pass. Merge using **Merge commit** only.
7. After the hotfix PR merges, `.github/workflows/main-to-dev-sync.yml` automatically performs a hard-coded `main → dev` clean back-merge using the repository automation GitHub App. It runs commitlint plus lint/typecheck/test before pushing.
8. If `main → dev` conflicts, the workflow must fail without resolving. Resolve the conflict on a dedicated sync branch and return through a normal PR to `dev`; that PR uses **Merge commit** like every other PR entry to `dev`.
9. Confirm the existing `release/versions` PR is regenerated from the new `dev` baseline if pending normal Changesets remain.

## Repository protection

- Normal human/agent identities never direct-push `dev` or `main`.
- `protected-branch-integrity` targets both branches and exclusively owns deletion and force-push protection; it has no bypass actor.
- `dev` allows PR entry by **Merge commit only**, requires `pr-commitlint` and `pr-quality`, and uses Loose up-to-date policy.
- `main` allows PR entry by **Merge commit only**, requires `pr-commitlint`, `pr-quality`, `pr-e2e`, and uses Strict up-to-date policy.
- `main` has no bypass actor; every release and hotfix enters through a PR.
- The repository automation GitHub App is the only bypass actor for the `dev` PR-entry ruleset, solely to support the controlled hotfix back-merge workflow.
- Neither humans nor the App bypass branch deletion or force-push protection.

## Version ownership

- Workspace `package.json#version` is the canonical release version for that application/package.
- Do not maintain a separate root product version.
- When OpenAPI generation is introduced, `apps/api/package.json#version` should feed `info.version` and deployment metadata rather than duplicating an API release version elsewhere.
- A future generated SDK may keep an independent version or be placed in a Changesets `fixed` group with its contract package only if coupling is intentionally required.

## Safety rules

- Never publish these private packages to npm as part of this workflow.
- Never manually edit package versions for ordinary features or fixes; use Changesets.
- Never merge an open Version Packages PR until the user explicitly decides to prepare/finalize that release candidate.
- Never merge unreleased `dev` work into an emergency hotfix.
- Never use a human/admin bypass to simulate the automation App.
- Never let privileged automation resolve a `main → dev` merge conflict automatically.
- Never use prerelease Changesets tooling unless the repository stable-only dependency policy is explicitly changed.
