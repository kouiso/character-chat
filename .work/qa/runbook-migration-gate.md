# D1 Migration Approval Gate Runbook

- Workflow: `.github/workflows/deploy.yml` の `migrate_d1` job は `environment: d1-migration` に紐づきます。
- 前提: GitHub repository の **Settings → Environments** で `d1-migration` を作成し、Required reviewers を設定します。
- 運用:
  1. `main` への push で deploy job（build/pages deploy）が先に実行されます。
  2. `migrate_d1` job は Environment 承認待ちで停止します。
  3. Maintainer が承認後、`pnpm exec wrangler d1 migrations apply DB --remote` が実行されます。
