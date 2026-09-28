# Cluster locks

When an app runs as several instances, some work must still happen exactly once: a nightly digest,
a cache rebuild, a cleanup pass. `withLock` runs a function while holding a named lock that every
instance respects.

```ts
import { withLock } from 'ohnejs';

await withLock('emails:digest', () => sendDailyDigest());
```

The lock is a row in the main database, so it applies to every instance of the app, not just other
code in this process. Whoever acquires the lock runs the function. Everyone else calling `withLock`
with the same key waits until it is released, then takes their turn.

The lock is released when the function finishes, whether it succeeds or throws. `withLock` returns
whatever the function returned.

`withLock` needs the connected main database. Inside a running app, such as in a handler or a hook,
the database is always connected. [Boot files](../project/boot.md) run before the
[connection](./engine.md) opens, so a boot file calls `withLock` from a hook such as
[`server:ready`](../project/hooks.md#serverready), never at its top level. A cron job written as a
[command](../project/commands.md) finds the database connected, like a handler.

## Skipping a held lock

To skip work that another instance is already doing, pass `wait: false`:

```ts
import { withLock } from 'ohnejs';

const pruned = await withLock('cache:prune', () => pruneCache(), { wait: false });
```

While another caller holds the lock, `withLock` resolves `undefined` at once, and the function
does not run.

## Crashes

The lock is renewed while the function runs, so the work can take as long as it needs. If the
process holding it crashes, the renewals stop, and the next caller takes the lock over within 20
seconds.

A renewal waits while a [transaction](./engine.md#transactions) is open on the connection. Keep each
transaction inside the function under 20 seconds, or another caller can take the lock over while
your work still runs.

## Timing

`pollInterval` is how often a waiting caller re-checks a held lock, in milliseconds. It defaults to
`250`:

```ts
await withLock('reports:rebuild', () => rebuildReports(), { pollInterval: 500 });
```

Waiting has no limit: a caller waits until the lock is released or its holder has crashed.

## Rules

- `withLock` is not reentrant. A call on a key the calling function holds throws, even from work it
  started without awaiting.
- The key `sync` is reserved for the [schema sync](./sync.md). Passing it throws immediately.
