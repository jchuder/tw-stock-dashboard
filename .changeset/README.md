# Changesets

這個目錄存放各 workspace package 尚未套用到版本號的 release intent。
每個 workspace 都有自己的獨立版本號。

- 有 releasable change 時：
  - 執行 `pnpm changeset`。
  - 選擇所有直接受到影響的 package。
  - 分別指定 patch、minor 或 major。
- 一般 feature branch：
  - 將產生的 `.changeset/*.md` 和實作一起 commit。
  - branch 最後 merge 到 `dev`。
  - **不要**在一般 feature branch 執行 `changeset version`。
- `dev` 上的版本自動化：
  - 會收集目前 pending Changesets。
  - 將版本變更集中到由 bot 管理的 `release/versions` pull request。
- Hotfix：
  - 一律從 `main` 開 branch。
  - 建立 hotfix Changeset 後，在 hotfix branch 執行 `pnpm version:packages` 與 `pnpm install --lockfile-only`。
  - 確認版本與 CHANGELOG 後，再開 PR 到 `main`。
- 一般開發期間不要手動修改 workspace `package.json` 裡的 `version`。

完整流程請看：

- `docs/versioning-and-releases.md`
  - 一般開發、release、hotfix、tag 與常見問題。
- `docs/versioning-github-setup.md`
  - 第一次啟用 GitHub automation 前需要手動完成的 repository 設定。
- `.agents/skills/release-versioning/SKILL.md`
  - Agent 執行版本管理工作時應遵守的規則。
