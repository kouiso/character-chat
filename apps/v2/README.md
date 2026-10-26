# v2 local Worker

RIT-59: `src/server.ts` checks BASIC authentication before assets, Start SSR,
server functions, server routes, or SSE handlers. The comparison is shared with
legacy Pages through `@v2/cf/basic-auth`. Missing/empty secrets return an empty
503; invalid/missing credentials return an empty 401 with a Basic challenge.
`assets.run_worker_first: true` includes direct static-file requests.

## Local verification

Use Node 22.23.4 and pnpm 9.15.9 with the existing workspace lockfile.

```sh
pnpm --filter @v2/app test
pnpm --filter @v2/app typecheck
pnpm --filter @v2/app lint
pnpm --filter @v2/app build
pnpm --filter @v2/app test:auth:http
pnpm --filter @v2/app test:state:http
```

The HTTP check starts built workerd on loopback, creates an isolated temporary
SQLite schema with no character rows, injects synthetic BASIC credentials, and
removes its own temporary state/processes afterward. It never invokes a model.
It checks pages, API/SSE entry paths, static assets, HEAD, OPTIONS, bad/missing
credentials, missing/empty secrets, and authorized access. Successful SSE
forwarding is additionally checked by the entry unit test with a mock stream.

For manual local work, use **synthetic values only** for `BASIC_AUTH_USER` and
`BASIC_AUTH_PASS` in a new ignored `apps/v2/.dev.vars`. Existing secret files
must not be overwritten. `pnpm --filter @v2/app dev` runs in workerd; leave
`CF_REMOTE` unset and do not select the `remote` Wrangler environment.

`pnpm --filter @v2/app cf:typegen` regenerates binding types from the local
configuration. Optional secret names are declared separately in `src/env.d.ts`.
The generated declaration is excluded from ESLint like the generated route tree.

## Failure checks and preservation

- A missing configuration must fail before touching a DB, model, or asset binding.
- Method/path shortcuts must not bypass the shared gate; rejected bodies stay empty.
- A mock SSE response must keep its original stream without buffering.
- Worker-only imports must stay behind `createServerOnlyFn`; otherwise the client
  build fails while resolving `cloudflare:workers`.
- Work uses an independent branch and clean checkout; no existing WSL, Claude,
  Devin, database, corpus, or unpushed work is modified.

Only the local acceptance of RIT-59 is covered here. RIT-43 still requires
external production checks of workers.dev, version URLs, direct static/SSE
URLs, and credential absence in the repository/logs. No deployment or real
secret setup is performed by these commands.

The workspace currently pins Workers types 4.20260317.1. Wrangler 4.152.0 warns
that its optional types peer expects v5. Mixing v5 only into this app produces
duplicate Drizzle nominal types via workspace peers; a coordinated workspace
types upgrade remains separate. Runtime build, typecheck and local HTTP checks
are the evidence for this combination, not the absence of install warnings.

An optional screenshot of the authenticated empty local list can be captured by
setting `RIT59_SCREENSHOT` to a new output path for `test:auth:http`. If the
Playwright-managed Chromium binary is absent, `RIT59_BROWSER_CHANNEL=chrome`
uses installed Chrome with a separate temporary profile; it does not reuse an
existing browser session. No browser download is required.

RIT-62's independent local mock probe and its unfulfilled production acceptance
conditions are recorded in [probe/README.md](probe/README.md).

The Vite plugin, migration CLI and legacy `createPlatform()` share paths from
`@v2/cf/path`: repository `.wrangler/state` for the plugin/CLI and its `v3` child
for `getPlatformProxy`. `test:state:http` copies source into a fresh temporary
checkout, applies only a synthetic migration through the existing migration
helper, saves synthetic messages with the real TurnStore, and starts the
normal Vite development command without a persistence override. It checks the
authenticated page and successful history API before and after restart, and
asserts that no app-local state store exists. It never copies or reads existing
`.wrangler` state or credentials. `RIT59_STATE_REGRESSION_CONTROL=1` removes the
plugin path only in that temporary checkout and must fail, reproducing the
split-store regression.
