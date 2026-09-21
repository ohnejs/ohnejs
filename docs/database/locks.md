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
[`server:ready`](../project/hooks.md#serverready), never at its top level. A standalone script, such
as a cron job, [opens the connection itself](./engine.md#outside-the-app).

## Timing

A third argument adjusts the timing of a call:

```ts
await withLock('reports:rebuild', () => rebuildReports(), {
  pollInterval: 500,
  staleAfter: 5 * 60_000,
});
```

- `pollInterval` is how often a waiting instance re-checks a held lock, in milliseconds.
  Defaults to `250`.
- `staleAfter` is the time after which a held lock counts as abandoned and is taken over. A lock is
  abandoned when its holder crashed without releasing it. Defaults to one minute.

`staleAfter` must be longer than the longest time the guarded work can take. If the work can take
five minutes, a one-minute `staleAfter` lets another instance take over the lock while the work is
still running.

Waiting has no limit. There is no timeout and no try-once option: a caller waits until the lock is
released or goes stale.

## Rules

- `withLock` is not reentrant. A nested call on the same key waits until it takes over the outer
  lock after `staleAfter`.
- The key `sync` is reserved for the [schema sync](./sync.md). Passing it throws immediately.
