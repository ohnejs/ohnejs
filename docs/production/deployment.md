# Deployment

An ohne app deploys as the source you wrote. There is no build step: Node 26 runs the `.ts` files
directly, so what you deploy is your repository plus its installed dependencies. Production runs
the same commands as your machine: [`ohne serve api`](../project/cli.md#ohne-serve), and
`ohne serve dashboard` if you use the dashboard. Each is a plain long-running process.

## What a deploy needs

Install, then serve:

```sh
npm install
npx ohne serve api
```

The install runs [`ohne prepare`](../project/cli.md#ohne-prepare) through the scaffolded `prepare`
script, so the types are ready for `npm run typecheck` in CI. The server regenerates them at boot
anyway, so it never runs with outdated types. [`SKIP_CODEGEN=1`](../project/env.md#the-built-ins)
skips that step when the install has already prepared them.

The API and the dashboard are separate processes on separate ports. Run each under your process
manager, each with its own `PORT`:

```sh
PORT=8080 npx ohne serve api
PORT=8081 npx ohne serve dashboard
```

The dashboard tells the browser where the API is. It builds the address from the `api` config. That
only works when the browser can reach that host directly. Behind a proxy or across domains:

- Set [`dashboard.apiURL`](../project/config.md#the-dashboard), or the `API_URL` env var, to the
  public API base URL, `api.basePath` included.
- Set `dashboard.origin`, or `DASHBOARD_URL`, to the dashboard's own public origin, so [CORS](#cors)
  lets it call the API.

## Readiness

The port opens last. Layers load, [boot files run](../project/boot.md#when-they-run), codegen
writes, the database connects and its schema syncs, and only then does the server listen. So an
accepted connection means the server is ready: point your platform's probe at the port, as a TCP
check or a request to any route you serve.

A failed boot, like a refused sync or a bad config, never opens the port. The probe never passes,
and the previous instance keeps serving.

Supervisors get more signals once the server listens:

- The process prints ``API ready at `http://...` ``.
- A process spawned with an IPC channel sends a `'ready'` process message.

To announce the address yourself, to a service registry for example, register the
[`server:ready`](../project/hooks.md#serverready) hook from a boot file.

## Schema changes

The [schema sync](../database/sync.md) runs inside every boot, guarded against data loss. Run this
check in your pipeline before the new build takes over:

```sh
npx ohne sync --dry-run
```

It [rehearses](../database/migrations.md#rehearsing) the whole sync against the live database and
rolls it back, so a bad schema change fails CI while the old build still serves.
[Syncing without serving](../database/sync.md#syncing-without-serving) explains how to apply the
change after that.

## Data on disk

SQLite is a file: `.data/ohne.db` by default, relative to the project root, and
[overridden](../database/engine.md#where-the-database-lives) by `database.url` or the `DATABASE` env
var. It runs in WAL mode, so two sidecar files sit beside it, `ohne.db-wal` and `ohne.db-shm`. The
three files are one database.

In production that means:

- Keep the data directory on a persistent volume. A container's writable layer disappears with the
  container, and so does the database.
- Never separate the three files. Move, copy, and restore all three together.
- Back up with the app stopped, where copying the directory is enough, or use SQLite-aware tooling
  against the live file. A plain file copy while the app writes can copy the file and its journal
  at different moments and produce a corrupt copy.

[Helper databases](../database/engine.md#helper-databases) are files too, each with its own
sidecar files. The same rules apply.

## Behind a proxy

By default ohne trusts no proxy: `api.trustProxy` is empty, forwarding headers are ignored, and
ohne trusts only the socket connection itself. Behind a load balancer,
[`event.ip`](../api/request.md#the-event) is then the balancer's address and `event.url` reads as
plain `http`.

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  api: {
    trustProxy: ['10.0.0.0/8'],
    allowedHosts: ['api.example.com', '*.example.com'],
  },
});
```

- `trustProxy` lists the CIDR ranges your proxies connect from. ohne then trusts their
  `X-Forwarded-For`, `X-Forwarded-Proto`, and `X-Forwarded-Host` headers. The RFC 7239 `Forwarded`
  header is ignored, since proxies often pass it through unchanged from the client.
- `allowedHosts` limits which hosts the server answers to: a request whose `Host` matches none of
  the patterns is refused with `400` before routing. When empty, the server answers to any host.

If the proxy limits request bodies, keep
[`uploads.chunkSize`](../uploads/resumable.md#sizes-and-limits) under that limit, so every chunk of
a large upload gets through.

## CORS

The `ohnejs/base` layer mounts a global [`cors` middleware](../api/middleware.md#cors): only the
dashboard's origin may read API responses, cookies included.

- When the dashboard is reached at any address other than `dashboard.host` on `dashboard.port`,
  like a public domain or a port changed with `PORT`, set `DASHBOARD_URL` or `dashboard.origin`
  to that origin. Otherwise the browser blocks its requests.
- Set `DASHBOARD_URL` on the API process, not the dashboard's.
- Every browser frontend that signs in needs its origin in the cors policy, with credentials. A
  write that rides the session cookie from any other page gets a `403`, as
  [cross-site requests](../auth/authentication.md#cross-site-requests) explains.
- Behind a proxy, set `api.trustProxy` so the API knows its public origin.

## Secrets

Each secret is a long random value. Set the ones your app uses:

- `COOKIE_SECRET` signs [cookies](../api/request.md#signed-cookies). Without it, signing throws.
- `UPLOADS_SECRET` signs [image variant URLs](../uploads/image-variants.md#connecting-a-service) and
  the links of [private files](../uploads/private-files.md#the-secret). Without it, a private file
  opens only for a signed-in reader and variant URLs are unsigned.

```sh
COOKIE_SECRET=zug-zug-work-work-jobs-done
UPLOADS_SECRET=frostmourne-hungers
```

When you store files with [`@ohnejs/uploads-s3`](../uploads/storage.md#storing-files-in-s3), also set
`AWS_ACCESS_KEY_ID` and `AWS_SECRET_ACCESS_KEY`.

Set them in the process environment, or in a [`.env`](../project/env.md#the-env-file) at the project
root on a single-host deploy. The file only sets variables the environment does not have and never
overrides it, so a value set by the platform always wins.

## Graceful shutdown

`SIGTERM` and `SIGINT` both start the same ordered drain: stop accepting connections, wait for
in-flight requests and their [`waitUntil`](../api/response.md#after-the-response) work, then close
the database. These `api` settings control it:

- `preStopDelay` - keep serving this long after the signal before refusing connections. This gives
  the load balancer time to deregister the instance. Default: refuse at once.
- `shutdownTimeout` - how long in-flight work may take to finish. When it expires, every request
  still in flight is cancelled, even one that already answered and only runs `waitUntil` work: its
  connection closes and [`useRequest().signal`](../api/request.md#the-request) aborts. Shutdown
  then waits for it to clean up. Default: wait with no time limit.
- `deadline` - a global limit for all shutdown steps together: the pre-stop delay, the drain, that
  cleanup, and the database close. Default: wait with no time limit.

Work that ignores its signal holds shutdown until `deadline`. A handler past its
[`handlerTimeout`](../project/config.md#the-api-server) is answered with `503` but keeps running, so
shutdown waits for it like any other request.

The process exits `0` on a clean drain, and `1` when the deadline passes first. Keep the total below
your platform's kill timeout, or the platform `SIGKILL`s the process during the drain. Kubernetes
gives 30 seconds by default, and PM2's `kill_timeout` gives only 1.6:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  api: {
    preStopDelay: '5s',
    shutdownTimeout: '20s',
    deadline: '28s',
  },
});
```

## Capacity

The `api` group also holds the settings that control load.
[The API server](../project/config.md#the-api-server) lists each one with its default. For
production:

| Setting                                             | When to set it                                                                                            |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `maxConnections`                                    | To limit how many sockets one instance accepts at the same time. No limit by default.                     |
| `maxBodySize`, `handlerTimeout`                     | When some routes need larger bodies or more time. Prefer [per route](../api/routes.md#per-route-options). |
| `maxHeaderSize`, `headersTimeout`, `requestTimeout` | To drop oversized or slow clients sooner than Node's defaults, or to give slow uploads more time.         |
| `keepAliveTimeout`                                  | Behind a load balancer that reuses connections, set it above the balancer's idle timeout.                 |
| `waitUntilTimeout`                                  | To limit background `waitUntil` work, which a graceful shutdown otherwise waits for.                      |

Sign-in runs its password checks on Node's thread pool and uses at most half of it, answering `503`
past that. For more sign-ins at once, raise the pool with the `UV_THREADPOOL_SIZE` env var (`4` by
default), set before the process starts.

[Rate limits](../api/rate-limiting.md#across-processes) count in each process's memory by default,
so every instance allows a client the full limit. Point them at a shared helper database to count
once.

## Logs

Everything the app prints goes through one printer:

- `SILENT=1`, or `printer.silent` in config, drops every line.
- `DEBUG=1` adds debug output.
- The env var [wins over config](../project/env.md#environment-beats-config) when set.
