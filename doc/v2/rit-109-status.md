# RIT-57 / RIT-95 / RIT-109 proactive notification handoff

Status: notification policy/store and scheduled dispatch verified with synthetic inputs, fake clocks and native local Durable Object storage. Product entry points and real delivery are pending integration; this is not a Done claim.

## Authoritative requirements and selected scope

- [RIT-57](https://linear.app/ritmo-inc/issue/RIT-57): opted-in characters speak outside quiet hours, stop after OFF, respect limits.
- [RIT-95](https://linear.app/ritmo-inc/issue/RIT-95): per-character opt-in, quiet hours in Japan time, daily limit, idle interval and a Durable Object alarm schedule. The hostile case is a PDT host clock.
- [RIT-109](https://linear.app/ritmo-inc/issue/RIT-109): with cap 3, no fourth notification; zero after OFF; two alarm retries still produce one notification.
- [RIT-107](https://linear.app/ritmo-inc/issue/RIT-107): use memory and the previous summary in a message, including memory-empty behavior. This branch does not change memory/generation ownership or fabricate a provider contract.
- [RIT-108](https://linear.app/ritmo-inc/issue/RIT-108): Web Push, iPhone installed-PWA receipt, notification navigation and an in-app denied-permission state. Real delivery/device verification is excluded by the current no-real-notification/no-configuration authorization. No device success is claimed.

The expanded work selected RIT-95 alongside RIT-109 because their policy, persistence and scheduling form one independent ownership area. It does not alter ordinary generation idempotency (RIT-90), character CRUD, memory, message rendering, app error flows, auth or environment setup.

## Behavior and persistence

- Default OFF. Per-character default daily limit 3; explicit `configureCharacter` settings take precedence. The recipient-level fallback setter is deliberately named `setDefaultDailyLimit`, not a setter for configured characters.
- Quiet hours and day counters use JST (UTC+09:00), independent of host timezone. Quiet intervals include their start and exclude their end, and can cross midnight. `null` disables quiet hours; equal endpoints are rejected as ambiguous.
- `idleMinutes` is a positive integer. Initial opt-in schedules after the configured idle interval. `recordActivity` postpones the next occurrence from the last activity time; clock reversal never moves that activity backward.
- Settings, activity, occurrence IDs, schedule revisions, daily counters and receipts persist. Preferences and `setAlarm`/`deleteAlarm` changes commit in one native storage transaction.
- One recipient owns one Durable Object/storage binding. All characters' plans share its single native alarm, always set to the earliest next occurrence. Their daily caps are independent. All store instances for that binding share the serial queue.
- `runAlarm` invokes the same reservation/dispatch policy as `handleAlarm`, processes due characters and rearms the next occurrence. Settings updates, OFF/ON and activity replace the occurrence ID, invalidating stale plans.
- OFF resolves after any send already in progress settles, cancels that character's pending occurrence and leaves other characters' schedules intact. After OFF resolves, no later queued dispatch for that character starts.
- The send reservation and daily slot commit before the injected sink is invoked. Sending failures preserve both. A reservation crossing JST midnight or entering quiet hours while commit is pending is suppressed before the sink call.
- A sink failure cannot starve later due characters: each attempted occurrence is advanced/rearmed, remaining due characters are processed, and the first sink failure is then rethrown. A storage failure retains its occurrence for a safe retry.

At-most-once attempts are intentional: a crash after reservation but before delivery may lose a notification. A failed/unknown send is not refunded or resent. Exactly-once external delivery requires an idempotent transport/reconciliation protocol outside this branch. Receipts have no expiry because no scheduler retry horizon is specified. Day counters use separate JST date keys, including when the clock moves backward.

The initial unshipped RIT-109 commit used a UTC/recipient-aggregate assumption. The authoritative related RIT-95 requirements corrected both to JST/per-character in this branch. The storage prefix is `proactive:v2`; the earlier `proactive:v1` implementation was never connected to an application or deployed, so no live-data migration is performed.

## Ownership and integration contract

Owned files:

- `apps/v2/src/server/proactive-notification-policy.ts`
- `apps/v2/src/server/proactive-notification-store.ts`
- `apps/v2/src/server/proactive-notification-store.test.ts`
- `apps/v2/src/server/proactive-notification-schedule.test.ts`
- `apps/v2/src/test/proactive-notification-fixture.ts`
- `script/verify/proactive-notification-local.mjs`
- this handoff document

Base: `f229642` on dedicated branch `codex/rit-109-proactive-policy`. Integration owner supplied branch `codex/rit-59-entry-basic-auth-20261026`, HEAD `cc079948eeb82fd5733e000dd7413d5f2facea1a`; its other-environment worktree is not mounted here and is not claimed as tested.

The integration owner must construct one store per recipient's existing Durable Object using the exact native `ctx.storage` binding. The API contract is:

```ts
const store = new ProactiveNotificationStore({ recipientId, storage: ctx.storage });

await store.configureCharacter(characterId, {
  enabled,
  dailyLimit,
  idleMinutes,
  quietHours: { startMinute, endMinute },
});
await store.recordActivity(characterId);
await store.setCharacterEnabled(characterId, false);
await store.runAlarm(notificationSink);
```

`notificationSink.send` receives `{ alarmId, characterId, idempotencyKey }`. It is an injected metadata-only boundary; no character text or provider key is read here. Stable occurrence IDs are persisted by the schedule. External callers of the lower-level `handleAlarm` must preserve their original occurrence ID across retries. Use `configureCharacter` to change a configured character's cap; `setDefaultDailyLimit` only changes the fallback for unconfigured characters.

No proactive scheduler, preference API, notification service worker or PWA sink exists at the base commit. This branch supplies the internal schedule-to-policy-to-sink path and a real local DO consumer in the verification harness, but does not modify protected application entry points or bindings:

- `apps/v2/src/server/api-chat.ts:39`: ordinary generation acceptance, RIT-90 ownership.
- `apps/v2/src/server/api-chat.ts:65`: history.
- `apps/v2/src/server/platform.ts:10`: existing environment/entry ownership.
- `apps/v2/src/routes/api/chat/$id.ts:8`: ordinary chat route.
- `apps/v2/wrangler.jsonc`, Vite, root dependencies and lockfiles: unchanged.

Connecting authenticated settings, activity and `alarm()` to these APIs and configuring the recipient DO binding belongs to the integration/environment owner. Real Web Push configuration and real iPhone delivery remain outside current authorization. No prohibited action was attempted or denied for these pending items.

## Verification and premortem

Premortem risks were retries after partial send, OFF racing in-flight work, JST day/quiet boundaries during commit, stale schedules after activity/settings changes, and sink failures starving other characters. Independent review findings on UTC, midnight commits, a misleading cap setter, and multi-character failures were incorporated and regression-tested.

From `apps/v2`, with the installed binaries and no package installation:

```sh
TZ=America/Los_Angeles ../../node_modules/.bin/vitest run --maxWorkers=1 --reporter=verbose src/server/proactive-notification-store.test.ts src/server/proactive-notification-schedule.test.ts
../../node_modules/.bin/tsc -p tsconfig.json --noEmit
../../node_modules/.bin/eslint --config ../../eslint.v2.config.js src/server/proactive-notification-*.ts src/test/proactive-notification-fixture.ts
```

Result: 33 synthetic tests passed after the November 1 adversarial-review fix; app typecheck and changed-TypeScript lint passed. The environment's global pnpm 11 tried an automatic install and failed at `/home/agent/.local/share/pnpm` during the initial work; direct installed binaries avoid it. No root dependency or lockfile changes were made. Repository-wide tests are not claimed because unrelated real-character/corpus fixtures must not be read.

From the repository root:

```sh
TZ=America/Los_Angeles node script/verify/proactive-notification-local.mjs .work/rit-109-local
```

The harness resolves already-installed Miniflare/esbuild through Wrangler and creates a fresh isolated SQLite Durable Object storage directory without using D1, existing sessions, Wrangler config or provider keys. It checks cap 3/fourth blocked, OFF/alarm deletion, 22:00–07:00 JST quiet time, two retries/one notification, eight simultaneous failing characters all rearmed, receipt dedup after runtime restart, and settings/activity/schedule restoration. External outbound calls are blocked and the observed outbound-attempt count is zero.

The native `alarm()` method is invoked explicitly through a synthetic RPC at fake-clock instants; native alarm storage is verified, while wall-clock automatic firing is deliberately not used. Synthetic dates are in 2099 to prevent accidental automatic execution. The evidence screenshot displays these test results and is not a product UI screenshot.

No real notifications, LLM/provider calls, live database reads, character/corpus/secret reads, push, CI, merge, deploy or configuration/permission changes were performed. Image generation is outside this change. Working changes are confined to the owned file list above.

## Transfer status

No inter-task send tool is exposed in this environment; the collaboration tools reach only local review subagents. Direct communication with the Mac integration task cannot be claimed. A final patch/archive, SHA256 and Library identifiers are emitted in the task outcome for independent retrieval. Library-side re-read/byte verification, if successful, proves availability through that artifact path; it does not prove the Mac integrator has already imported or re-tested the change.

## November 1 adversarial review and local checks

The user subsequently authorized ordinary branch push and PR bot discussion/resolution, with local CI accepted. Earlier no-push/no-CI notes above describe the October 26 authorization. Merge, deployment, real notifications, protected app entry/configuration edits, real-user data and corpus access remain outside this task.

Premortem review found a P2: when a daily-limit decision commits across JST midnight, calculating reset from the later clock can skip the entire fresh day. The fix carries `dailyResetAt` from the quota-decision transaction to schedule rearming. The next time is `max(dailyResetAt, currentTime, lastActivityAt + idleMs)`, adjusted for quiet hours. A proposed extra idle interval was rejected during mutual review because it would delay an ordinary 23:30 JST cap decision from 00:00 to 00:30.

Regression tests cover dispatch/rearm/final-alarm transaction commits crossing midnight and preserve the normal exact-midnight reset. Public `handleAlarm` outcomes are unchanged. Two independent reviewers agreed after discussing the initial finding and the additional-idle objection. Their probes covered four strict midnight cases and 2,000 seeded synthetic operations (292 sink notifications, 22 injected failures, no cap/OFF/quiet/duplicate violations). See `rit-109-adversarial-review.json` for the scope and limits of their agreement.

Current local results: 33 scoped tests, app typecheck, changed-file lint, native isolated SQLite DO probe, and 7 shared-CI contract tests pass. No real notification or provider call was made. Self-review and both reviewers score the explicitly implemented policy/store/scheduler contract 100/100 with no unresolved reproduced finding. That score does not cover product integration, automatic wall-clock firing, real PWA delivery or an iPhone device.

GitHub discussion, remote push and Dots approval status are reported from their actual tool results separately; no external review or integration completion is inferred from this local score.
