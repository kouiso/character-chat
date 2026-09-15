# User GATE notifications

Issue: [#105](https://github.com/kouiso/adult-ai-app/issues/105)

Migration Manager can call the notifier when it reaches a user approval GATE:

```sh
npm run notify:gate -- \
  --gate "Phase E" \
  --message "123 char migration completed. User approval required." \
  --source-log /tmp/migration-manager.log
```

## Channels

The notifier sends to every configured channel and always records local JSONL evidence.

| Channel | Environment variable | Payload |
| --- | --- | --- |
| Slack DM / channel webhook | `GATE_SLACK_WEBHOOK_URL` | `{ "text": "..." }` |
| Email webhook | `GATE_EMAIL_WEBHOOK_URL` | `{ "subject": "...", "text": "..." }` |
| Generic web/PWA bridge webhook | `GATE_WEBHOOK_URL` | `{ "title": "...", "message": "...", "sourceLog": "..." }` |
| Local evidence | `GATE_EVIDENCE_PATH` | JSONL, default `/tmp/adultai-gate-notifications.jsonl` |

Use `--dry-run` to verify channel discovery without posting webhooks. Dry runs still write local evidence.
