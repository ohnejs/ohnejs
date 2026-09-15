# Cluster locks

When an app runs as several instances, some work must still happen exactly once: a nightly digest,
a cache rebuild, a cleanup pass. `withLock` runs a function while holding a named lock that every
instance respects.

```ts
import { withLock } from 'ohnejs';

await withLock('emails:digest', () => sendDailyDigest());
```

The lock is a row in the main database, so it excludes every instance of the app, not just other
code in this process. Whoever acquires the lock runs the function; everyone else calling
`withLock` with the same key waits until it is released, then takes their turn.

The lock releases when the function settles - on success and on throw alike - and `withLock`
returns whatever the function returned.

`withLock` needs the connected main database. Inside a running app - a handler, a hook - that is a
given. [Boot files](../project/boot.md) run before the [connection](./engine.md) opens, so a boot
file calls `withLock` from a hook such as [`server:ready`](../api/hooks.md#serverready), never at
its top level. A standalone script, such as a cron job,
[opens the connection itself](./engine.md#outside-the-app).

## Timing

Two options tune a bid:

```ts
await withLock('reports:rebuild', () => rebuildReports(), {
  pollInterval: 500,
  staleAfter: 5 * 60_000,
});
```

- `pollInterval` is how often a waiting instance re-checks a held lock, in milliseconds.
  Defaults to `250`.
- `staleAfter` is when a held lock counts as abandoned - a holder that crashed without releasing -
  and is taken over. Defaults to one minute.

`staleAfter` must exceed the worst-case duration of the guarded work. If the work can take five
minutes, a one-minute `staleAfter` lets another instance steal the lock mid-run.

Waiting is unbounded. There is no timeout and no try-once option - a contender blocks until the
lock is released or goes stale.

## Rules

- `withLock` is not reentrant. Nesting it on the same key stalls until the inner call steals the
  outer lock after `staleAfter`.
- The key `sync` is reserved for the [schema sync](./sync.md). Passing it throws immediately.
