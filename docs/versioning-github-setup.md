# GitHub Release 與 Repository Governance 一次性設定

本專案的 Changesets、commitlint、PR CI 與 hotfix back-merge workflow 已放在 repository 中。GitHub App、repository variables / secrets 與 Rulesets 屬於 repository-level 權限，需由 repository owner 手動設定一次。

## 1. 建立 repository-scoped GitHub App

建立一個專門給本 repository automation 使用的 GitHub App，例如：

```text
tw-stock-dashboard-automation
```

建議設定：

- Webhook：關閉。
- Installation：只安裝在 `jchuder/tw-stock-dashboard`。
- Repository permissions：
  - Contents：Read and write。
  - Pull requests：Read and write。
- 不授予 Administration、Actions write、Secrets、Deployments 或其他不需要的權限。

這個 App 同時負責：

1. `Version Packages` workflow push `release/versions` 並建立 / 更新 `release/versions → dev` PR。
2. hotfix PR merge 到 `main` 後，由 `Sync Main to Dev` workflow 執行受控的 `main → dev` clean back-merge。

App installation token 由 workflow 執行時短暫建立，不使用個人 PAT。

## 2. 設定 Client ID 與 Private Key

建立 GitHub App private key 後，在 repository 設定：

### Actions variable

```text
AUTOMATION_APP_CLIENT_ID=<GitHub App Client ID>
```

位置：**Settings → Secrets and variables → Actions → Variables**。

### Actions secret

```text
AUTOMATION_APP_PRIVATE_KEY=<完整 GitHub App private key PEM>
```

位置：**Settings → Secrets and variables → Actions → Secrets**。

Secret 必須保存完整 PEM，包括開頭與結尾，例如：

```text
-----BEGIN RSA PRIVATE KEY-----
...
-----END RSA PRIVATE KEY-----
```

或 GitHub 實際產生的 `BEGIN PRIVATE KEY` / `END PRIVATE KEY` 格式。不要只貼中間的 key body；完整 multiline PEM 可直接貼入 Secret。

workflow 使用官方 `actions/create-github-app-token`，token scope 只涵蓋目前 repository，並在 job 結束時自動 revoke。

因為 Version Packages PR 改由 GitHub App token 建立，不再依賴 repository `GITHUB_TOKEN` 建立 PR，因此 **不需要**開啟「Allow GitHub Actions to create and approve pull requests」。

## 3. PR CI 的固定 required check 名稱

`.github/workflows/pr-ci.yml` 提供三個固定 check：

```text
pr-commitlint
pr-quality
pr-e2e
```

其中：

- `pr-commitlint`：檢查 PR 的 `BASE..HEAD` 全部 commits。
- `pr-quality`：執行 lint、typecheck、deterministic tests。
- `pr-e2e`：只在 PR target 是 `main` 時執行 Playwright E2E。

不要用 workflow-level `paths:` filter 跳過 required workflow，避免 docs-only PR 因 required status 永遠沒有回報而卡住。

## 4. 建立 branch integrity Ruleset

建立 Ruleset：

```text
protected-branch-integrity
```

Target branches：

```text
dev
main
```

啟用：

- Restrict deletions。
- Block force pushes。

Bypass actors：**none**。

這一層刻意不允許 automation App bypass，因此 App 也不能刪除或 force-push `dev` / `main`。
`Restrict deletions` 與 `Block force pushes` 只放在這個 integrity Ruleset；不要在 `dev-entry` 或 `main-entry` 重複設定，讓「永遠禁止的 ref mutation」與「允許如何進入 branch」保持分層。

## 5. 建立 dev-entry Ruleset

Target：

```text
dev
```

啟用：

- Require a pull request before merging。
- Allowed merge methods：**Merge commit only**。
- Required approvals：0。
- Require conversation resolution before merging。
- Require status checks to pass：
  - `pr-commitlint`
  - `pr-quality`
- **不要**啟用 require branch to be up to date before merging；`dev` 採 Loose policy，避免平行 AI PR 每次有其他 PR merge 就反覆 update branch / 重跑 CI。
- 不在此 Ruleset 重複啟用 Restrict deletions 或 Block force pushes；這兩項由 `protected-branch-integrity` 統一持有。

Bypass actor：只加入 `tw-stock-dashboard-automation` GitHub App，使用 Always allow。

這個 bypass 只用於 `.github/workflows/main-to-dev-sync.yml` 的受控 direct back-merge。一般人類與使用人類 Git credentials 的 AI agent 都不能直接 push `dev`。

`dev` 使用 Merge commit 是為了在 Git graph 與 `git log --first-parent dev` 中保留每個 reviewed PR 的整合邊界；PR 內的 logical commits 仍完整保留。若 iterative AI history 需要整理，必須由使用者明確觸發 `branch-commit-cleanup`，不能用 merge method 取代 history cleanup。

## 6. 建立 main-entry Ruleset

Target：

```text
main
```

啟用：

- Require a pull request before merging。
- Allowed merge methods：**Merge commit only**。
- Required approvals：0。
- Require conversation resolution before merging。
- Require status checks to pass：
  - `pr-commitlint`
  - `pr-quality`
  - `pr-e2e`
- 啟用 require branch to be up to date before merging；`main` 採 Strict policy。
- 不在此 Ruleset 重複啟用 Restrict deletions 或 Block force pushes；這兩項由 `protected-branch-integrity` 統一持有。

Bypass actors：**none**。

因此正常 release 必須走 `dev → main` PR；production hotfix 必須走 `hotfix/* → main` PR，而且兩者都以 Merge commit 進入 `main`。即使 automation App 也不能 direct push `main`。

## 7. Version Packages PR 的使用方式

只要 `dev` 上存在 pending `.changeset/*.md`，`Version Packages` workflow 就會建立或更新：

```text
release/versions → dev
```

這個 PR 是 **rolling release-plan preview**，不是「一出現就要 merge」的 PR。

- `dev` 還要繼續累積同一批 release 的功能 / fix：保持 Version Packages PR open。
- 新的 Changeset merge 進 `dev`：workflow 會從最新 `dev` 重建 `release/versions`，重新計算聚合後的 bump，並更新同一個 open PR。
- 明確準備 / freeze 下一個 release candidate：review 版號、CHANGELOG、internal dependency bump 後，才以 **Merge commit** merge `release/versions → dev`。
- Version Packages PR merge 後，pending Changesets 已被 consume 成實際 `package.json#version` 與 CHANGELOG；確認 release candidate 後再開 `dev → main` Release PR。

因此 automation 開出 Version Packages PR 只表示：「如果現在 freeze，下一版會長這樣。」它不代表 automation 已決定要 release。

## 8. Hotfix back-merge automation

`Sync Main to Dev` 只會在以下情況自動執行：

```text
PR 已 merge
base = main
head = hotfix/*
head repository = current repository
```

source / target hard-code 為：

```text
main → dev
```

workflow 不接受 branch inputs，也不 force push。它先在 runner 建立真正的 `git merge --no-ff` result，再執行 commitlint、lint、typecheck 與 deterministic tests；全部通過才 push `dev`。

若 `main` 已包含在 `dev` 中則 no-op。若發生 merge conflict，workflow 直接失敗，不自行解衝突；改由 dedicated sync branch 解衝突並走一般 PR 回 `dev`，該 PR同樣使用 **Merge commit**。

`workflow_dispatch` 保留為無參數 recovery fallback，只能重新執行同一個 `main → dev` 動作。

## 9. 建議啟用與驗證順序

1. 先建立並安裝 GitHub App。
2. 設定 `AUTOMATION_APP_CLIENT_ID` 與完整 `AUTOMATION_APP_PRIVATE_KEY` PEM。
3. 讓 `PR CI` 至少成功跑過一次，使 required check 名稱可在 GitHub 設定中選取。
4. 建立 `protected-branch-integrity`、`dev-entry`、`main-entry` Rulesets。
5. 用一般 feature PR 驗證 `dev` 無法 direct push、只能 Merge commit，且 required checks 生效。
6. 讓一個含 Changeset 的 PR 進 `dev`，確認 Version Packages workflow 能建立 / 更新 `release/versions → dev` PR；在尚未準備 release 時保持該 PR open。
7. 準備 release 時 merge Version Packages PR，再用 release PR 驗證 `main` 只能 Merge commit，且 Strict + E2E gate 生效。
8. 下一次真正 hotfix 時驗證 `hotfix/* → main → dev` 自動回灌；不要為了測試而製造假的 production hotfix。
