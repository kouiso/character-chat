# v2 local integration

This integration keeps TanStack Start and the custom `src/server.ts` Worker entry.
It combines the reviewed RIT-71 context window, RIT-67/69/70 delivery store, RIT-79/85
UI, RIT-90 durable generation, and RIT-105/106/113 character editor. It does not replace
the application with the separate RIT-136 architecture.

## Runtime contract

- `BASIC_AUTH_USER` and `BASIC_AUTH_PASS` gate assets, SSR, server functions, API and
  SSE before dispatch. Missing/empty configuration returns 503; invalid credentials
  return 401. `assets.run_worker_first` stays true.
- A personal authenticated installation maps to the server-owned `local` principal.
  Browser input cannot select an owner. The BASIC password is not an ownership key.
- `CHAT_ROOMS` routes by principal and conversation. Acceptance and alarm scheduling
  share a DO transaction. A stable generation ID reaches the graph and the D1 writer.
  Failed unsaved jobs release their reservation; old retries cannot overwrite a new
  generation. Alarm recovery reads committed chunks, identity and schedules from D1.
- D1 commit compares owner, next turn, write ID and canonical payload inside the
  writing batch. Identical replay preserves IDs, schedules and audit rows. Legacy
  replacement cannot overwrite a guarded turn.
- HTTP history reads owner, numbered messages and delivery rows in one D1 batch.
  The UI renders committed delivery snapshots, hides future chunks and preserves
  already elapsed time on replay. A new API response missing a matching delivery is
  rejected rather than displaying unscheduled assistant text.
- Pending request ID/cursor are saved before POST. Completed history restoration
  does not POST. An explicit input-reset action handles stale/terminal requests;
  unknown conversations start a new ID, while unavailable reads retain pending input.
  Input over the existing 4000-character API limit is rejected before persistence.

## Model boundary

`APP_ENV=test` together with `V2_FAKE_MODEL=1` enables the synthetic model. Other
environments do not enable it. No provider credential or deployed configuration was
created or changed for this integration.

`V2_MODEL`, `V2_MODEL_PROVIDER` and `V2_OPENROUTER_BASE_URL` are forwarded from the
Worker environment. The configured model strings follow Linear, without asserting
model availability or real response quality. All routes require the DeepSeek base
provider exclusion and `data_collection=deny`; fallback-1 additionally fixes Venice
with provider fallback disabled. No direct Venice credential is introduced.

`V2_MODEL_ATTEMPT_TIMEOUT_MS` is a positive integer, default 30000. Each attempt
records its configured timeout, route, requested/observed identity, reason and
latency. Unknown observed identity remains null. This is a per-attempt setting;
the existing graph deadlines also apply to generation/extension/regeneration.

The strict SDK adapter accepts the graph's text system/human/assistant messages.
Unsupported tool/multimodal inputs fail explicitly. Malformed SSE, SSE error payloads
and missing terminal markers are failures. A failed attempt's buffered text is never
published. The wrapper awaits metadata persistence before proceeding or returning
text. Managed cancellation/audit failures propagate through the graph, including
when the graph deadline wins, and cannot create an empty committed success.

Successful generations retain up to five model-call groups with three attempts
each. The separate metadata-only attempt table also retains all-stage failures
without creating a successful conversation/turn. Prompt, user body, raw reply and
credentials are excluded from that table.

## Local data and migrations

The Cloudflare Vite plugin and CLI migration helper share `@v2/cf/path`'s
repository-root `.wrangler/state` path. Additive migrations 0076–0083 contain chunk
schedules/rejections/anchors, turn CAS, character profiles/versions and model audits.
They were generated from isolated schema snapshots. No live migration was applied.
Existing unknown character ages remain NULL and fail validation; only synthetic
fixtures assign their explicitly chosen age.

Character editing, draft recovery and version restore use the server's `local`
owner. Save/restore CAS and revision tokens prevent stale/ABA overwrites. New list
data and delayed saves preserve the editor and current list. Image execution is
outside this text-chat integration.

## Reproduction with synthetic state

Use the installed Node 22 / pnpm 9 environment. The HTTP harness copies source into
a fresh temporary checkout, supplies synthetic credentials, applies synthetic schema
and the selected additive migrations, and cleans its own Worker/state afterward.
It never opens the checkout's existing state or env files.

```sh
pnpm --dir packages/engine run test --runInBand
pnpm --dir packages/engine run typecheck
pnpm --dir packages/engine run lint
pnpm --dir apps/v2 run test --maxWorkers=1
pnpm --dir apps/v2 run typecheck
pnpm --dir apps/v2 run lint
pnpm --dir apps/v2 run build
pnpm --dir apps/v2 run test:auth:http
RIT90_RUNTIME_HTTP=1 pnpm --dir apps/v2 run test:state:http
RIT90_RUNTIME_HTTP=1 RIT90_FAULT=1 pnpm --dir apps/v2 run test:state:http
RIT90_RUNTIME_HTTP=1 RIT62_MOCK_GATEWAY=1 RIT90_BROWSER=1 pnpm --dir apps/v2 run test:state:http
```

`RIT90_BROWSER=1` uses a new headless Chrome profile. `RIT90_BROWSER_EVIDENCE` can
choose a local screenshot directory. The fault check instruments only its temporary
source copy to record that the existing test-only interruption executed. It waits
for native alarm recovery before a second POST and checks one generation/attempt.

The mock-gateway mode uses real app graph/SDK/DO/D1 code against a loopback Node
server. It verifies primary 503/fallback, concurrent conversation/audit isolation,
reload without POST, stable generation/schedule and mobile/desktop layout. Its
observed provider/model values are synthetic, not evidence of real API success.

## Remaining acceptance

RIT-43/44 and the entire app are not Done from these local checks. Real Gateway/model
operation, model quality, production behavior, near-limit bundle/startup tests and
external verification remain unverified and outside the current execution scope.
The prior small RIT-62 probe's CPU/size figures must not be presented as app figures.

RIT-103 daily/Gateway limit numbers require the user's choice and are not implemented
by the output/attempt bounds above. RIT-114 character-specific content migration is
not performed. Memory, document and proactive-notification source deliveries are
received separately; their application route/compose/alarm integration remains
pending. General PDF support and the memory/document priority rule remain open.
No PR, merge, deployment, actual model request, fee, CI trigger, real data access,
permission change or `fail_open` change is part of this local integration.
