# RIT-62: local mock evidence

This probe is separate from the application. It uses the actual LangGraph
1.4.13 and ChatOpenRouter 0.4.11 libraries under workerd, but the model endpoint
is a Node HTTP SSE fixture bound to `127.0.0.1`. The Worker rejects any other
protocol or hostname before constructing the model. Its API key is a literal
synthetic fixture. No real credentials, model API, AI Gateway, deployment,
existing database, character text, or corpus are used.

```sh
pnpm --filter @v2/app probe:build
pnpm --filter @v2/app probe:test
pnpm --filter @v2/app probe:startup
```

Node 22.23.4 / pnpm 9.15.9 / Vite 8.2.1 / Cloudflare Vite plugin 1.65.0 /
Wrangler 4.152.0 were used on the Mac for the 2026-10-26 local run.

| Observation                                     | Measured result                        |
| ----------------------------------------------- | -------------------------------------- |
| Probe JS bundle                                 | 2,870,910 bytes                        |
| gzip of JS bundle                               | 610,076 bytes                          |
| CLI process start → loopback ready              | 816.7 ms                               |
| Local Worker startup CPU profile window         | 46.6 ms                                |
| Local Worker startup sampled active time        | 18.5 ms                                |
| First response bytes, two concurrent turns      | 20.6 ms / 17.9 ms                      |
| Complete mock SSE, two concurrent turns         | 47.4 ms / 45.1 ms                      |
| Events per turn                                 | token, token, done                     |
| Mock endpoint requests                          | exactly 2                              |
| AsyncLocalStorage request IDs                   | left/right remained separate           |
| Date 2024-01-01 with no Node compatibility flag | rejected: no module `node:async_hooks` |

The CLI ready time includes Wrangler boot and is **not** Worker startup CPU.
`probe:startup` packages the already built module into a temporary local
multipart bundle and explicitly supplies `--workerBundle` to Wrangler. The
source was checked: this avoids its implicit `deploy --dry-run` build branch.
The resulting local CPU profile is `dist/probe/startup.cpuprofile`.

These values are for a small synthetic graph that calls ChatOpenRouter.stream
inside one generate node. They do not measure the application's full graph or
production hardware. The application itself builds for workerd and has its
own RIT-59 HTTP test.

RIT-62 remains incomplete: AI Gateway routing and a real model turn, production
Worker measurements, near-size-limit behavior and near-1-second Worker startup
behavior have not been tested. This probe does not establish any of those
acceptance conditions. RIT-44 and RIT-43 must not be marked Done from these
local results.
