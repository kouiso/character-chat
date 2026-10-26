# RIT-109 proactive notification policy/store

Status: independent implementation verified; application integration pending.

## Scope and behavior

- Dedicated branch: `codex/rit-109-proactive-policy`, based on `f229642`.
- `apps/v2/src/server/proactive-notification-policy.ts` evaluates OFF, duplicate and daily-cap decisions.
- `apps/v2/src/server/proactive-notification-store.ts` persists preferences, per-recipient counters and alarm receipts through a transaction interface compatible with native `DurableObjectStorage`.
- Default OFF; default cap 3 per recipient across all characters. Day boundaries are UTC. OFF/ON does not reset quota or receipts.
- `handleAlarm` reserves the stable occurrence ID and daily slot atomically before calling the injected notification sink. An alarm retry must retain its original occurrence ID, unique within the recipient.
- All instances sharing the same storage binding serialize OFF and dispatch. OFF resolves after any send already in progress settles. Later queued alarms observe OFF. The future scheduler must own one recipient-scoped Durable Object and use the same storage binding for settings and dispatch.
- No actual notification adapter, notification transport, scheduling, generation or content is added.

## Failure semantics

At-most-once attempts are intentional. If a notification transport fails, or execution stops after reservation and before delivery, the receipt and daily slot remain consumed. Retrying does not resend. This favors avoiding duplicate notifications over guaranteed delivery. Exactly-once external delivery would require an idempotent sink protocol and reconciliation, outside this policy/store task.

Receipts are retained without automatic expiry so arbitrarily late retries, including on another day, remain suppressed. A retention strategy requires an agreed scheduler retry horizon. Counters are keyed by UTC date so moving the clock backward does not reopen a day's quota.

## Premortem and checks

Main risks: duplicate alarms after partial failure, OFF racing an active send, and quota leakage at midnight or restart. Synthetic tests exercise cap 3/fourth blocked, zero after OFF, two retries/one sink notification, concurrent duplicates, cross-character quota, recipient isolation, UTC midnight, clock reversal, OFF/ON, storage reconstruction, transaction rollback/replay and ambiguous transport failure. Native Durable Object storage compatibility is checked by TypeScript. No real character fixtures, corpus, secrets, databases or sessions are used.

Run from `apps/v2` with the existing installed binaries:

```sh
../../node_modules/.bin/vitest run --maxWorkers=1 --reporter=verbose src/server/proactive-notification-store.test.ts
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
../../node_modules/.bin/eslint --config ../../eslint.v2.config.js src/server/proactive-notification-policy.ts src/server/proactive-notification-store.ts src/server/proactive-notification-store.test.ts
```

The environment's global pnpm is 11.25.0 while the project declares 9.15.9. Its automatic dependency check tried to install and failed at `/home/agent/.local/share/pnpm`; installed local binaries were used instead. Dependency manifests and lockfiles were not changed. The test selection is limited to this synthetic suite; the repository-wide suite would read unrelated fixtures and is not claimed as verified.

## Exact integration blocker

At base SHA `f229642`, no proactive scheduler, Durable Object alarm handler, notification preference API or PWA notification sink exists in `apps/v2/src`, `packages`, or the legacy application. A source search for proactive/notification/alarm finds no relevant runtime consumer. Existing unrelated Slack error reporting and scene-phase escalation are not proactive notification paths.

- `apps/v2/src/server/api-chat.ts:39` handles ordinary generation acceptance (RIT-90 territory).
- `apps/v2/src/server/api-chat.ts:65` handles history.
- `apps/v2/src/server/platform.ts:10` initializes the existing platform (protected environment/entry territory).
- `apps/v2/src/routes/api/chat/$id.ts:8` registers ordinary chat; it is not a notification alarm route.

These files are unchanged. Creating or rewiring application entry points, bindings or Wrangler configuration is outside the explicitly authorized policy/store scope. There is no existing proactive callsite to patch. No application integration or product screenshot is claimed; the evidence screenshot only displays the executed synthetic sink harness.

When the proactive scheduler/settings/transport implementation exists, its owner must:

1. Construct `ProactiveNotificationStore({ recipientId, storage: ctx.storage })` inside the recipient's existing Durable Object.
2. Await `setCharacterEnabled(characterId, enabled)` for preference changes and `setDailyLimit(limit)` for the configured cap.
3. Invoke `handleAlarm({ alarmId: persistedOccurrenceId, characterId }, notificationSink)` from the alarm handler, preserving that occurrence ID across retries. Only this method may call the sink for proactive delivery.
4. Keep the generation idempotency path separate and validate the resulting complete application flow.

This branch must not be marked Done solely because the isolated policy/store tests pass. UI, image generation, auth, context budget, root dependencies, lockfiles, Vite/Wrangler/D1 persistence, CI and other assigned feature paths are unchanged. No push, merge, deployment, paid call or real notification was performed.
