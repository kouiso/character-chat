# Cloudflare Pages deploy readiness evidence

This repository is configured to keep deployment authority outside GitHub Actions and to avoid secret exposure in CI logs.

## Readiness checks

- `pnpm verify:no-github-actions-deploy`
  - Confirms no workflow contains a direct Pages deploy path.
- `pnpm verify:pages-deploy-readiness`
  - Verifies required deploy files exist (`wrangler.toml`, `package.json`, `README.md`).
  - Confirms `wrangler.toml` has pinned `name` and `compatibility_date`.
  - Confirms deploy command remains local/manual via `wrangler pages deploy dist`.
  - Scans workflow YAML for high-risk secret output patterns (`echo ${{ secrets.* }}`, `printenv`, etc.).

## PR evidence workflow

Workflow: `.github/workflows/pages-deploy-readiness.yml`

On pull requests to `main`, it:

1. Installs dependencies with lockfile integrity.
2. Builds `dist/` deploy artifact.
3. Runs deploy ownership and readiness checks.

The pass/fail result of step 3 **is** the evidence; it no longer uploads `dist/` as a
GitHub Actions artifact (removed 2026-08, see below). No workflow or human ever
downloaded it, and it alone consumed ~73% of the org's monthly Actions storage
quota (500MB/month, shared across all `ritmo-inc` repositories), which is what
exhausted the quota org-wide in August 2026. If the built output itself is ever
needed for audit, it is always reproducible by checking out the PR commit and
running `pnpm build` locally — nothing about it is unique to the CI run.

This provides a PR-ready evidence trail without embedding deployment secrets in GitHub Actions,
and without paying an ongoing storage cost for a build output nobody retrieves.

## Deploy procedure

```bash
pnpm build
wrangler pages deploy dist --project-name adult-ai-chat
```

Verify the canonical URL after deploy:

```bash
pnpm deploy:verify-url
# Cloudflare Access-protected URL → 302 (expected).
# Deployment-specific preview URL → 200 (expected).
```

## Rollback procedure

### Option A — Cloudflare dashboard (no CLI required, fastest)

1. Open Cloudflare Dashboard → **Pages** → `adult-ai-chat` → **Deployments**.
2. Locate the last known-good deployment.
3. Click **⋮** → **Rollback to this deployment**.
4. Confirm. Completes in under one minute with no rebuild.

### Option B — Git revert + redeploy

```bash
# Identify the bad commit
git log --oneline -10

# Create a revert commit (keeps history intact)
git revert <bad-commit-sha> --no-edit
git push origin main

# Redeploy from reverted state
pnpm build
wrangler pages deploy dist --project-name adult-ai-chat
```

### Rollback trigger conditions

| Condition | Action |
|-----------|--------|
| Chat returns 503 (missing secret) | Option A — immediate dashboard rollback |
| UI renders blank or JS crash on load | Option A — rollback while investigating diff |
| Image generation broken (Novita 5xx) | Check Novita status first; rollback if regression confirmed |
| D1 migration applied with data corruption | Restore D1 snapshot from Cloudflare dashboard, then Option A |

Cloudflare Pages retains all past deployments indefinitely; Option A is always available.
