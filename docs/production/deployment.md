# Deployment

An ohne app deploys as the source you wrote. There is no build step: Node 26 runs the `.ts` files
directly, so the artifact is your repository plus its installed dependencies. Production runs the
same commands as your machine - `ohne serve api`, and `ohne serve dashboard` if you use the
dashboard - each a plain long-running process.

## What a deploy needs

Install, then serve:

```sh
pnpm install
pnpm exec ohne serve api
```

The scaffolded `package.json` wires `"prepare": "ohne prepare"`, so the install itself runs
codegen through npm's own lifecycle hook - the generated types are in place for a `pnpm typecheck`
in CI with no extra step. The server regenerates them at boot anyway, so a stale artifact cannot
serve; `SKIP_CODEGEN=1` skips that pass when the install already prepared.

The API and the dashboard are separate processes on separate ports. Run each under your process
manager, each with its own `PORT`:

```sh
PORT=8080 pnpm exec ohne serve api
PORT=8081 pnpm exec ohne serve dashboard
```

The dashboard tells the browser where the API lives. By default it derives the address from the
`api` config, which only works when the browser can reach that host directly. Behind a proxy or
across domains, set `dashboard.apiURL` (or the `API_URL` env var) to the public API origin. See
[config](../project/config.md).

## Readiness

The port opens last. Layers load, boot files run, codegen writes, the database connects and its
schema syncs - only then does the server listen. An accepted connection is therefore the readiness
signal: point your platform's probe at the port, as a TCP check or a request to any route you
serve. A failed boot - a refused sync, a bad config - means the port never opens, the probe never
passes, and the previous instance keeps serving.

Two more signals for supervisors: once listening, the process prints ``API ready at `http://...` ``
and, when spawned with an IPC channel, sends a `'ready'` process message. To announce the address
yourself - to a service registry, say - register the `server:ready` [hook](../api/hooks.md) from a
boot file.

## Schema changes

The [schema sync](../database/sync.md) runs inside every boot, guarded against data loss. For a
deploy, gate the pipeline before cutover:

```sh
pnpm exec ohne sync --dry-run
```

It rehearses migrations, diff, and guard against the live database, then rolls everything back,
exiting non-zero exactly where a real boot would refuse - a bad schema change fails CI while the
old build still serves. For the change itself, either let the new build's boot apply it, or stop
the app, run `ohne sync`, and start; the sync page covers both.

## Data on disk

SQLite is a file: `.data/ohne.db` by default, resolved against the project root, overridden by
`database.url` or the `DATABASE` env var - see [the database](../database/engine.md). It runs in
WAL mode, so two sidecars sit beside it, `ohne.db-wal` and `ohne.db-shm`, and the three are one
database.

In production that means:

- The data directory lives on a persistent volume. A container's writable layer vanishes with the
  container, and the database with it.
- The trio never separates. Move, copy, and restore all three together.
- Back up with the app stopped, where copying the directory is enough, or use SQLite-aware tooling
  against the live file. A plain file copy while the app writes can catch the file and its journal
  at different moments and produce a corrupt copy.

[Helper databases](../database/engine.md#helper-databases) are files too, each with its own
sidecars. The same rules apply.

## Behind a proxy

By default ohne trusts no proxy: `api.trustProxy` is empty, forwarding headers are ignored, and
the socket is the only truth. Behind a load balancer that means `event.ip` is the balancer's
address and `event.url` reads as plain `http`. List the CIDR ranges your proxies connect from, and
their `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` are honored:

```ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  api: {
    trustProxy: ['10.0.0.0/8'],
    allowedHosts: ['api.example.com', '*.example.com'],
  },
});
```

Only `X-Forwarded-*` is read; the RFC 7239 `Forwarded` header is ignored, since proxies often pass
it through unchanged from the client.

`allowedHosts` closes the other direction: a request whose `Host` matches none of the patterns is
refused with `400` before routing. Empty, the server answers to any host.

## CORS

With no cors middleware mounted, the API allows any origin - an open default, applied last and
only when nothing else decided. An app that authenticates with cookies wants an explicit allowlist
in production: mount the `cors` middleware as a global and the default steps aside. See
[middleware](../api/middleware.md#cors).

## Secrets

Signed cookies sign with the `COOKIE_SECRET` env var - a long random value. Without it, signing
throws rather than sign under a blank key, so set it before the app needs it. See
[reading the request](../api/request.md).

Set it in the process environment, or in a `.env` at the project root on a single-host deploy. The
file fills what the environment lacks and never overrides it, so a value the platform injects
always wins. See [the `.env` file](../project/env.md#the-env-file).

## Graceful shutdown

`SIGTERM` and `SIGINT` funnel into one ordered drain: stop accepting, wait for in-flight requests
and their `waitUntil` work, then close the database. Three `api` settings shape it:

- `preStopDelay` - keep serving this long after the signal before refusing connections, buying the
  load balancer time to deregister the instance. Default: refuse at once.
- `shutdownTimeout` - how long to wait for in-flight work to drain. When it expires, the remaining
  connections are destroyed so the process can still exit. Default: wait indefinitely.
- `deadline` - a global cap over every shutdown step combined, the pre-stop delay, the drain, and
  the database close included. Default: wait indefinitely.

The process exits `0` on a clean drain, `1` when the deadline won. Fit the sum inside your
platform's kill window - Kubernetes grants 30 seconds by default, PM2's `kill_timeout` only 1.6 -
or the platform `SIGKILL`s the process mid-drain:

```ts
export default defineConfig({
  api: {
    preStopDelay: '5s',
    shutdownTimeout: '20s',
    deadline: '28s',
  },
});
```

## Capacity

The `api` group also carries the load-shaping knobs. Durations and sizes take a number or a string
like `'30s'` and `'1mb'`; `false` turns a knob off. The full surface, with every default, lives in
[config](../project/config.md).

| Setting            | Default       | Caps                                                           |
| ------------------ | ------------- | -------------------------------------------------------------- |
| `maxConnections`   | unbounded     | Concurrent sockets the server accepts.                         |
| `maxBodySize`      | `'1mb'`       | Request body size; anything over is refused with `413`.        |
| `maxHeaderSize`    | 16 KiB (Node) | Total request header block.                                    |
| `handlerTimeout`   | `'30s'`       | Middleware and handler runtime; on overrun the reply is `503`. |
| `headersTimeout`   | 60s (Node)    | Wait for the complete request headers.                         |
| `requestTimeout`   | 5m (Node)     | The entire request, headers and body.                          |
| `keepAliveTimeout` | 5s (Node)     | Idle keep-alive socket between requests.                       |
| `waitUntilTimeout` | off           | Background `waitUntil` work after the response.                |

## Logs

Everything the app prints goes through one printer. `SILENT=1`, or `printer.silent` in config,
drops every line; `DEBUG=1` adds debug output; env wins over config when set. See
[env](../project/env.md).
