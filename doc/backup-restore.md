# D1 / R2 Backup & Restore Runbook

## D1 Backup

### Manual Export

```bash
# Export full D1 schema + data to local SQL file
pnpm exec wrangler d1 export DB --remote --output ./backup-$(date +%Y%m%d).sql
```

### Restore to Scratch DB (Disaster Recovery Drill)

This drill requires live Cloudflare credentials. Run it manually once per quarter after a backup artifact is available.

```bash
# 1. Create scratch DB for the drill
pnpm exec wrangler d1 create adult-ai-db-restore-drill

# 2. Import backup file into the scratch DB
# Current project Wrangler exposes restore via execute --file.
pnpm exec wrangler d1 execute adult-ai-db-restore-drill --remote --file ./backup-YYYYMMDD.sql --yes

# If a future Wrangler version exposes d1 import, use this equivalent restore command instead:
pnpm exec wrangler d1 import adult-ai-db-restore-drill --remote ./backup-YYYYMMDD.sql

# 3. Verify table list and row counts against production
pnpm exec wrangler d1 execute DB --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

pnpm exec wrangler d1 execute adult-ai-db-restore-drill --remote \
  --command "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;"

pnpm exec wrangler d1 execute DB --remote \
  --command "SELECT COUNT(*) AS cnt FROM message;"

pnpm exec wrangler d1 execute adult-ai-db-restore-drill --remote \
  --command "SELECT COUNT(*) AS cnt FROM message;"

# 4. Delete scratch DB when done
pnpm exec wrangler d1 delete adult-ai-db-restore-drill --skip-confirmation
```

### Restore Production (EMERGENCY ONLY)

Only run this if production D1 is corrupted or deleted. Confirm the backup date and keep the backup file read-only.

```bash
# Current project Wrangler restore path
pnpm exec wrangler d1 execute DB --remote --file ./backup-YYYYMMDD.sql --yes

# If a future Wrangler version exposes d1 import, use this equivalent restore command instead:
pnpm exec wrangler d1 import DB --remote ./backup-YYYYMMDD.sql
```

## R2 Lifecycle Policy

`adult-ai-images` bucket currently has no lifecycle policy. Images are stored at `images/{uuid}.{ext}`.

### Orphan Image Cleanup

Images are considered orphaned if:

- Not referenced in any `message` row's `image_metadata` column
- Older than 90 days

To estimate recently referenced images before changing lifecycle rules:

```bash
pnpm exec wrangler d1 execute DB --remote \
  --command "SELECT COUNT(*) FROM message WHERE image_metadata IS NOT NULL AND created_at > (strftime('%s','now') - 7776000) * 1000;"
```

R2 Object Lifecycle: Set via Cloudflare dashboard -> R2 -> adult-ai-images -> Settings -> Lifecycle Rules.

Recommended policy:

- Delete objects with prefix `images/`
- Delete objects older than 180 days
- Keep the 180-day window because images older than 6 months are not expected to be accessed

## Quarterly Drill Schedule

Run every 3 months: export D1, create scratch DB, import latest backup, verify counts, delete scratch DB.

Automation: `.github/workflows/backup-d1.yml` exports on the 1st of January, April, July, and October at 02:00 UTC. The successful restore test is intentionally manual because it requires live Cloudflare credentials and a scratch database created for the drill.
