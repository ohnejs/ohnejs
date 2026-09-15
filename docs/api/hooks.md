# Hooks

A hook is a named event the framework fires at a seam of its lifecycle - the server coming up, a
record about to be written, a response about to leave for the socket. You register a callback for
the name, and the framework calls it when the moment comes. Where [middleware](./middleware.md)
runs inside each request's pipeline and can answer it, a hook is process-wide: registered once, it
fires at every occurrence of its event, request or not.

```ts
// boot/ready.ts
import { hook } from 'ohnejs';

hook('server:ready', async ({ host, port }) => {
  await warmCache();
  console.log(`accepting connections at http://${host}:${port}`);
});
```

## Registering

`hook(name, fn)` appends the callback to the hook's chain, and checks its signature against the
hook's declared type - an unknown name or a wrong parameter is a compile error. Register from a
[boot file](../project/boot.md): boot runs before the port opens, so the callback is in place for
the first occurrence. The read and schema hooks name their payloads `QueryIR`, `QueryRecord`, and
`GuardReport`: import those from `ohnejs` to type a callback you declare apart from its `hook` call.

When a hook fires, its callbacks run in registration order, each awaited before the next, so a mix
of sync and async callbacks stays deterministic. Across [layers](../project/layers.md), the
furthest layer boots first - a base layer's callbacks run ahead of yours.

## Actions and filters

Every hook is one of two shapes, and the shape tells you what a callback may do.

An **action** returns nothing and runs for effect - `server:ready` warms a cache, `record:committed`
fires a webhook. Its return is ignored; a throw aborts the caller through the
[error funnel](./errors.md).

A **filter** threads a value. Its first argument is that value, and each callback's return replaces
it for the next; the last return is what the framework uses. Returning `undefined` means "no
change", so a callback can act on the cases it cares about and stay silent otherwise - which also
means a filter can never thread `undefined` as a value.

When the threaded value is a mutable object, the common shape is to change it in place and return
nothing:

```ts
// boot/headers.ts
import { hook } from 'ohnejs';

hook('response:headers', (headers) => {
  headers.set('X-Frame-Options', 'DENY');
});
```

## The hooks at a glance

Every built-in hook, by the lifecycle it belongs to. Each is covered below.

| Hook                   | Kind   | Fires                                                     |
| ---------------------- | ------ | --------------------------------------------------------- |
| `server:ready`         | action | the API server is listening                               |
| `request:complete`     | action | a dispatched request finished, background work drained    |
| `middleware:resolve`   | filter | a request's middleware list resolved, before it runs      |
| `handler:result`       | filter | a handler returned, before its value serializes           |
| `error:response`       | filter | a request threw, on the error response                    |
| `response:send`        | filter | a dispatched response is about to return to the transport |
| `response:headers`     | filter | any response's headers, the last seam before the socket   |
| `record:before-change` | filter | a create or update input, before coercion                 |
| `record:validate`      | filter | a create or update, after coercion, before the write      |
| `record:after-create`  | filter | a created record, re-read, before create returns          |
| `record:after-update`  | action | each record an update touched, re-read                    |
| `record:condition`     | filter | an update or delete `WHERE`, before it matches rows       |
| `record:before-delete` | action | a delete, before it removes its rows                      |
| `record:committed`     | action | a self-owned write committed, outside the transaction     |
| `query:filter`         | filter | a read's `QueryIR`, before it compiles to SQL             |
| `query:records`        | filter | a row read's assembled records, before it returns         |
| `query:complete`       | action | a row read finished, with its timing                      |
| `populate:targets`     | filter | a populate node's target records, before they key back    |
| `schema:synced`        | action | the schema reconcile committed                            |
| `dashboard:menu`       | filter | the dashboard sidebar resolved, before discovery answers  |

## Server lifecycle

### `server:ready`

Runs once the API server is listening, after the socket accepts and before readiness is announced.
The callback receives the bound `host` and `port` - read `port` to learn the real port when
`api.port` is `0`. Warm a cache, open a pool, announce the address to discovery. For teardown,
register `onShutdown` instead.

```ts
// boot/ready.ts
import { hook } from 'ohne';

hook('server:ready', async ({ host, port }) => {
  await warmCache();
  console.log(`listening on http://${host}:${port}`);
});
```

### `request:complete`

Fires once a dispatched request finishes: the response written and every `waitUntil` promise
drained. Reach for it when a trace must cover background work, not close when the response is sent.
It runs outside the request context, so read the passed `event`, not the composables. A router
miss, a refused host, and an off-prefix path never dispatch, so none of them fire it.

```ts
// boot/access-log.ts
import { hook } from 'ohnejs';

hook('request:complete', (event) => {
  log.info('request', {
    method: event.request.method,
    path: event.url.pathname,
    ip: event.ip,
  });
});
```

## The request pipeline

These filters wrap a request as it flows through dispatch. The first three run inside the request
context; the last two run at the transport edge, after it.

### `middleware:resolve`

Filters or reorders the middleware for a request, after the globals and the route's selection
resolve - globals first, then the route's list. Return the names to run, filtered or reordered. It
is the escape hatch for dynamic, per-request control; routine selection belongs
[on the route](./middleware.md). The list is a per-request copy, so leaving it untouched is safe.

```ts
// boot/middleware.ts
import { hook, matchesPath } from 'ohne';

hook('middleware:resolve', (names, event) =>
  matchesPath(event.url.pathname, '/public/**')
    ? names.filter((name) => name !== 'global-auth')
    : names,
);
```

### `handler:result`

Filters a handler's raw return value before it serializes into a `Response`. It fires for a handler
result and for a middleware short-circuit, each before serialization runs, so the replacement
serializes by the same rules: a `Response`, an [`HTTPError`](./errors.md), a string, or JSON. An
error outcome never lands here - filter those through `error:response`.

```ts
// boot/envelope.ts
import { hook } from 'ohnejs';

hook('handler:result', (result) =>
  result instanceof Response ? undefined : { data: result },
);
```

Returning `undefined` leaves a value unchanged, so the guard above wraps a plain result while
letting a hand-built `Response` pass straight through.

### `error:response`

Filters the response built when a request throws, inside the request context. It fires for a mapped
[`HTTPError`](./errors.md) and for an unhandled error's generic `500`; a non-throwing timeout `503`
is not an error outcome, so it does not fire. The callback receives the error response, the thrown
`error`, and the `event`. Return a replacement `Response` - a branded error page, a body with the
detail redacted - or report the error and return nothing. It runs before `response:send`, which
then sees whatever this returns.

```ts
// boot/errors.ts
import { hook } from 'ohnejs';

hook('error:response', (response, error) => {
  reportToSentry(error);
  if (response.status === 500) {
    return new Response('Something went wrong.', { status: 500 });
  }
});
```

### `response:send`

Filters the finished response of a dispatched request, just before it returns to the transport. It
fires for every dispatched outcome: a handler result, a middleware short-circuit, a mapped
`HTTPError`, the generic `500`, the timed-out `503`. It runs outside the request context, so read
the passed `event`, not the composables. A router miss (`404`/`405`) never enters dispatch and
skips it - reach for `response:headers` to cover those too.

```ts
// boot/no-store.ts
import { hook } from 'ohnejs';

hook('response:send', (response, event) => {
  if (event.url.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store');
  }
});
```

### `response:headers`

Filters a response's outgoing headers, the last seam before they are written to the socket. Unlike
`response:send`, it covers every response, including those that never enter dispatch: a router
`404`/`405`, a rejected-host `400`, a base-path miss. Stamp or strip a header in place and return
nothing, or return a replacement `Headers`; the read-only `response` is there for status context.

```ts
// boot/security-headers.ts
import { hook } from 'ohnejs';

hook('response:headers', (headers) => {
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
});
```

## Writing records

These hooks fire around [create, update, and delete](../database/writing.md). Most run inside the
write transaction, so a callback that writes on the passed `tx` commits atomically with the change
or not at all. Each carries a `ctx` naming the `collection`, so gate on it to target one collection.

### `record:before-change`

Filters the raw input of a create or update before the pipeline coerces it, inside the transaction.
It fires once per record, for both operations, before the input is frozen. One site covers every
caller, so a timestamps, tenant, or audit layer stamps input everywhere. Return a replacement
record, or mutate the passed object in place and return nothing.

```ts
// boot/timestamps.ts
import { hook } from 'ohnejs';

hook('record:before-change', (input, ctx) => {
  input.updatedAt = new Date().toISOString();
  if (ctx.operation === 'create') input.createdAt = input.updatedAt;
});
```

### `record:validate`

Filters the field errors of a create or update after coercion, before any precheck or write, inside
the transaction. Add the cross-field or cross-collection failures the per-field validator cannot
express. The threaded value is the errors so far, keyed by field path: spread it to add keys, or
return your own to replace. A non-empty result aborts the write as `{ ok: false, errors }` and
nothing is written; returning `undefined` or an empty map lets it proceed. Read the coerced values
from `scope.values`.

```ts
// boot/validate-events.ts
import { hook } from 'ohnejs';

hook('record:validate', (errors, scope, ctx) => {
  if (ctx.collection !== 'Events') return;
  const values = scope.values as { startsAt?: string; endsAt?: string };
  if (values.startsAt && values.endsAt && values.endsAt < values.startsAt) {
    return { ...errors, endsAt: 'End must come after start' };
  }
});
```

### `record:after-create`

Filters a freshly created record, re-read in its final state, just before the create returns. It
fires inside the transaction, so a search-index, revision, or audit write commits atomically with
the record. Return a replacement record to reshape what the caller receives, or return nothing to
leave it. The `ctx` carries the `collection`, the open `tx`, and the effective `locale`.

```ts
// boot/index-post.ts
import { hook, query } from 'ohnejs';

hook('record:after-create', async (record, ctx) => {
  if (ctx.collection !== 'Posts') return;
  await query('SearchIndex').use(ctx.tx).create({
    ref: record.UUID as string,
    text: `${record.title} ${record.body}`,
  });
});
```

### `record:after-update`

Runs for each record an update touched, re-read in its final state, inside the transaction. It
fires once per matched record, so it is genuinely per-row - use it for a per-record atomic effect,
a search-index row or a revision, written on the same `tx`. An action: the record passes through
unchanged.

```ts
// boot/reindex-post.ts
import { hook, query } from 'ohnejs';

hook('record:after-update', async (record, ctx) => {
  if (ctx.collection !== 'Posts') return;
  await query('SearchIndex')
    .use(ctx.tx)
    .where('ref', record.UUID as string)
    .update({ text: `${record.title} ${record.body}` });
});
```

### `record:condition`

Filters the `WHERE` condition of an update or delete before it resolves which rows are touched. It
fires once at the terminal's top, outside the transaction, before the matched set compiles.
Force-scope the write - a tenant filter, a soft-delete guard - by returning a narrowed condition.
The condition is a [`ConditionNode`](../database/queries.md): AND-fold your clause into it and
return the new node, or return nothing to leave the caller's condition as is.

```ts
// boot/tenant-writes.ts
import { hook } from 'ohnejs';

import { currentTenant } from '../lib/tenant.ts';

hook('record:condition', (condition, ctx) => {
  if (ctx.collection !== 'Posts') return;
  const scope = {
    kind: 'compare' as const,
    path: ['tenant'],
    op: 'equalsTo' as const,
    value: currentTenant(),
    negated: false,
  };
  return { kind: 'and', nodes: [condition, scope] };
});
```

### `record:before-delete`

Runs just before a delete removes its rows, inside the transaction, carrying the doomed `UUID`s.
Use it to clean up rows outside the cascade - an external mirror, a derived table - on the same
`tx`. The `ctx` carries the `collection`, the scoped `condition`, the `matched` UUIDs, and the open
`tx`. It fires only when it or `record:committed` has a subscriber; without one, the fast delete
never lists the doomed rows. A `deleteTranslation` never fires it, since every record it matches
survives.

```ts
// boot/cleanup-attachments.ts
import { hook, query } from 'ohnejs';

hook('record:before-delete', async (ctx) => {
  if (ctx.collection !== 'Posts') return;
  await query('Attachments')
    .use(ctx.tx)
    .where('post', (w) => w.in([...ctx.matched]))
    .delete();
});
```

### `record:committed`

Runs after a self-owned write commits, for external effects that must never fire on a rollback. It
fires post-commit, outside the transaction, so a cache bust, a webhook, or an external index is
safe. A joined `.use(tx)` write skips it: the effect defers to whoever owns the outer commit. The
payload carries the `collection`, the `operation`, and the affected `uuids`. A `deleteTranslation`
reports an `update` of the records that lost the locale.

```ts
// boot/webhook.ts
import { hook } from 'ohnejs';

hook('record:committed', async ({ collection, operation, uuids }) => {
  if (collection !== 'Posts') return;
  await fetch('https://hooks.example.com/posts', {
    method: 'POST',
    body: JSON.stringify({ operation, uuids }),
  });
});
```

## Reading records

These hooks fire around [reads](../database/queries.md) - scoping the query before it runs, and
shaping the rows after.

### `query:filter`

Filters the frozen `QueryIR` before a read terminal compiles it, so one scope reaches every read.
It fires once per SQL statement: `findMany`, `findFirst`, `count`, `exists`, and `pluck`'s column
path; a `paginate` fires it twice, once for its count and once for its rows. AND-inject a scoping
condition here: a tenant key, a soft-delete `deletedAt IS NULL`, an ACL clause. The `QueryIR` is
frozen, so mutating it throws - spread it, fold your clause into `condition` wrapped in an `and`
when one exists, and return the rebuilt IR.

```ts
// boot/soft-delete.ts
import { hook } from 'ohnejs';

hook('query:filter', (ir) => {
  if (ir.collection !== 'Posts') return;
  const live = { kind: 'compare' as const, path: ['deletedAt'], op: 'isNull' as const, negated: false };
  return {
    ...ir,
    condition: ir.condition ? { kind: 'and', nodes: [ir.condition, live] } : live,
  };
});
```

It does not reach populated targets, junction `UUID` lists, child composites, or blocks; those
bypass it. Reach for `populate:targets` to scope populated relations.

### `query:records`

Filters the whole assembled rowset once, after hydrate and populate, just before a row read
returns. It fires for `findMany`, `findFirst`, and `pluck`'s record fallback - `count`, `exists`,
and `pluck`'s column path return a scalar and do not fire. It runs once over the array, never per
row: add computed fields, redact output, decrypt at rest. Return a replacement `QueryRecord[]`, or
mutate the array in place and return nothing. The `context` carries the `collection` and the
resolved `ir`.

```ts
// boot/redact-users.ts
import { hook } from 'ohnejs';

hook('query:records', (records, { collection }) => {
  if (collection !== 'Users') return;
  for (const record of records) delete record.passwordHash;
});
```

### `query:complete`

Runs once when a row read finishes, carrying its timing and shape - an action for logging or
metrics. It fires only for the record reads, where `rowCount` is honest; `count` and `exists`
return a scalar and do not fire, so time those at the database adapter. `durationMs` spans compile,
query, hydrate, populate, and `query:records`, on the monotonic clock; `rowCount` is the returned
count after every transform.

```ts
// boot/slow-reads.ts
import { hook } from 'ohnejs';

hook('query:complete', ({ collection, rowCount, durationMs }) => {
  if (durationMs > 100) {
    console.warn(`slow read on ${collection}: ${rowCount} rows in ${durationMs}ms`);
  }
});
```

### `populate:targets`

Filters a populate node's freshly batch-read target records before they key back onto their
parents. Drop a soft-deleted or unauthorized target here: a dropped target leaves a `record` link
`null` and removes a `records` element, and its whole subtree disappears with it. Return the
filtered `QueryRecord[]`, or nothing to keep every target. The `context` carries the populate
`node` and its target `collection`.

```ts
// boot/populate-scope.ts
import { hook } from 'ohnejs';

hook('populate:targets', (targets, { collection }) => {
  if (collection !== 'Posts') return;
  return targets.filter((target) => target.deletedAt === null);
});
```

It covers only `record` and `records` populates, not junction `UUID` lists, child composites, or
blocks - those load outside the populate path, so this hook never sees them.

## Schema

### `schema:synced`

Runs after the database [schema reconcile](../database/sync.md) commits, carrying the run's
`GuardReport`. Register it to rebuild a search index, refresh a cache, or write an audit trail. The
report lists only destructive outcomes: `deletions` are rows purged under force or migration,
`warnings` are orphan rows left in place. A clean sync that only creates or alters tables reports
both empty, yet still fires. It fires under both `ohne serve api` and `ohne sync`, but never on a
dry run, which commits nothing.

```ts
// boot/sync-audit.ts
import { hook } from 'ohnejs';

hook('schema:synced', async (report) => {
  if (report.deletions.length > 0) {
    await notifyOps(`schema sync purged rows:\n${report.deletions.join('\n')}`);
  }
});
```

## The dashboard

### `dashboard:menu`

Filters the [sidebar menu](../dashboard/pages.md#the-sidebar) after `dashboard.menu` resolves, just
before `GET /dashboard` answers. It fires once per discovery read, inside the request context, so
the viewer's language is in scope. The groups arrive resolved: every row already carries a `to`, a
translated `label`, and any icon, so a layer can append a group without knowing the config. Return
a replacement `DashboardMenuGroup[]`, or mutate the array in place and return nothing.

Collection rows are already scoped to what the user may reach. A declared link is not - the
dashboard knows no capability for a page - so this is where you scope one:

```ts
// boot/menu.ts
import { hook } from 'ohnejs';

hook('dashboard:menu', (menu, { user }) => {
  if (user.roles.includes('admin')) {
    menu.push({ label: 'Ops', items: [{ to: '/audit', label: 'Audit log', icon: 'history' }] });
  }
});
```

The `context` also carries `collections`, the accessible collections as the same read describes
them, so a group can be built from the registry rather than named one by one.

## Declaring your own

A layer declares a hook by augmenting the `Hooks` interface - name it `group:name` in kebab-case,
type it as its callback signature. The declaration types both ends: `hook` checks callbacks against
it, and firing it takes the declared parameters. A callback that returns a value makes it a filter;
one that returns `void` makes it an action.

```ts
// boot/report-hooks.ts
import { hook } from 'ohnejs';

declare module 'ohnejs' {
  interface Hooks {
    'report:filename': (name: string, date: Date) => string;
  }
}

hook('report:filename', (name, date) => `${date.toISOString().slice(0, 10)}-${name}`);
```

`applyHook` fires it: every registered callback runs in order, the first argument threads through
their returns, and the final value comes back. An action fires the same way, just without using the
result.

```ts
import { applyHook } from 'ohnejs';

const name = await applyHook('report:filename', 'report.csv', new Date());
// -> '2026-07-21-report.csv'
```

With no callbacks registered, `applyHook` returns the first argument unchanged - firing a hook
nobody listens to costs nothing and breaks nothing.
