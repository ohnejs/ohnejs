# Hooks

A hook is a named event the framework fires at a fixed point in its lifecycle: the server starting,
a record about to be written, a response about to be sent to the socket. You register a callback for
the name, and the framework calls it when the moment comes. [Middleware](./middleware.md) runs
inside each request's pipeline and can answer the request. A hook, by contrast, is process-wide: you
register it once, and it fires every time its event happens, in a request or not.

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
hook's declared type, so an unknown name or a wrong parameter is a compile error. Register from a
[boot file](../project/boot.md): boot runs before the port opens, so the callback is ready the first
time the hook fires.

- When a hook fires, its callbacks run in the order they were registered. Each one is awaited before
  the next, so a mix of sync and async callbacks always runs in the same order.
- Across [layers](../project/layers.md), the
  [furthest layer boots first](../project/boot.md#ordering), so a base layer's callbacks run before
  yours.

## Actions and filters

Every hook is one of two kinds, and the kind tells you what a callback may do:

- An **action** returns nothing and runs for its side effect: `server:ready` warms a cache,
  `record:committed` fires a webhook. Its return value is ignored, and if a callback throws, it
  aborts whatever fired the hook.
- A **filter** threads a value through its callbacks. Its first argument is that value, and each
  callback's return value replaces it for the next callback. The framework uses the last return
  value.

Two rules apply to every filter, so the hooks below do not repeat them:

- Returning `undefined` means "no change", so a callback can handle the cases it cares about and
  return nothing for the rest.
- When the threaded value is a mutable object, you may change it in place and return nothing
  instead of returning a replacement.

```ts
// boot/headers.ts
import { hook } from 'ohnejs';

hook('response:headers', (headers) => {
  headers.set('X-Frame-Options', 'DENY');
});
```

Since `undefined` means "no change", a filter can never thread `undefined` as a value.

## The hooks at a glance

Every built-in hook, by the lifecycle it belongs to. The table holds all but `auth:account-layout`,
which [the account page](../dashboard/account.md#extending-the-page) covers.

| Hook                                                                | Kind   | Fires                                                      |
| ------------------------------------------------------------------- | ------ | ---------------------------------------------------------- |
| [`server:ready`](#serverready)                                      | action | the API server is listening                                |
| [`request:complete`](#requestcomplete)                              | action | a dispatched request finished, background work done        |
| [`middleware:resolve`](#middlewareresolve)                          | filter | a request's middleware list resolved, before it runs       |
| [`handler:result`](#handlerresult)                                  | filter | a handler returned, before its value serializes            |
| [`error:response`](#errorresponse)                                  | filter | a request threw, on the error response                     |
| [`response:send`](#responsesend)                                    | filter | a dispatched response is about to return to the transport  |
| [`response:headers`](#responseheaders)                              | filter | any response's headers, the last step before the socket    |
| [`record:before-change`](#recordbefore-change)                      | filter | a create or update input, before coercion                  |
| [`record:validate`](#recordvalidate)                                | filter | a create or update, after coercion, before the write       |
| [`record:after-create`](#recordafter-create)                        | filter | a created record, re-read, before create returns           |
| [`record:after-update`](#recordafter-update)                        | action | each record an update touched, re-read                     |
| [`record:condition`](#recordcondition)                              | filter | an update or delete `WHERE`, before it matches rows        |
| [`record:before-delete`](#recordbefore-delete)                      | action | a delete, before it removes its rows                       |
| [`record:committed`](#recordcommitted)                              | action | a self-owned write committed, outside the transaction      |
| [`query:filter`](#queryfilter)                                      | filter | a read's `QueryIR`, before it compiles to SQL              |
| [`query:records`](#queryrecords)                                    | filter | a row read's assembled records, before it returns          |
| [`query:complete`](#querycomplete)                                  | action | a row read finished, with its timing                       |
| [`populate:targets`](#populatetargets)                              | filter | a populate node's target records, before they are attached |
| [`schema:synced`](#schemasynced)                                    | action | the schema reconcile committed                             |
| [`dashboard:menu`](#dashboardmenu)                                  | filter | the dashboard sidebar resolved, before discovery answers   |
| [`auth:account-layout`](../dashboard/account.md#extending-the-page) | filter | the account page layout, and what `PATCH /auth/me` accepts |

## Server lifecycle

### `server:ready`

Runs once the API server is listening, after the socket accepts and before
[readiness](../production/deployment.md#readiness) is announced. Warm a cache, open a pool, or
announce the address to discovery, as the snippet at the top of this page does.

- The callback receives the bound `host` and `port`. Read `port` to learn the real port when
  [`api.port`](../project/config.md#the-api-server) is `0`.
- To clean up, register `onShutdown` instead. It runs when the process
  [shuts down](../production/deployment.md#graceful-shutdown).

### `request:complete`

Fires once a dispatched request finishes: the response is written and every
[`waitUntil`](./response.md#after-the-response) promise has settled. Use it when a trace must also
cover background work, instead of ending when the response is sent.

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

- It runs outside the request context, so read the passed `event`, not the composables.
- A router miss, a [refused host](../production/deployment.md#behind-a-proxy), and a path outside
  the base path are never dispatched, so none of them fire it.

## The request pipeline

These hooks run in two places:

- Inside the request context, where the composables work: `middleware:resolve`, `handler:result`,
  and `error:response`.
- At the transport edge, after the request context: `response:send` and `response:headers`. Read the
  arguments the callback receives, not the composables.

### `middleware:resolve`

Filters or reorders the middleware for a request, after the globals and the route's selection
resolve. The list arrives with the globals first, then the route's selection, and you return the
names to run.

It exists for the cases that need dynamic, per-request control, shown in
[middleware](./middleware.md#per-request-control). Routine selection belongs on the route.

### `handler:result`

Filters a handler's raw return value before it serializes into a `Response`. Use it to reshape every
result, like wrapping it in an envelope:

```ts
// boot/envelope.ts
import { hook } from 'ohnejs';
import { isArray, isPlainObject } from 'ohnejs/utils';

hook('handler:result', (result) =>
  isPlainObject(result) || isArray(result) ? { data: result } : undefined,
);
```

- It fires for a handler result and for a middleware short-circuit, each before serialization runs.
- The replacement serializes by the [same rules](./routes.md#what-a-return-becomes): a `Response`,
  an [`HTTPError`](./errors.md), a string, or JSON.
- A returned `HTTPError` also goes through this hook. A thrown error goes to
  [`error:response`](#errorresponse) instead.

The guard above wraps only a plain object or array. A `Response`, a returned `HTTPError`, a string,
an empty body, or a stream passes through.

### `error:response`

Filters the response built when a request throws. Return a replacement `Response`, such as a branded
error page or a body with the detail removed. Or report the error and return nothing:

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

- It fires for a mapped [`HTTPError`](./errors.md) and for an
  [unhandled error's generic `500`](./errors.md#unhandled-errors).
- A timeout `503` from [`handlerTimeout`](../project/config.md#the-api-server) does not throw, so it
  does not count as an error and does not fire this hook.
- The callback receives the error response, the thrown `error`, and the `event`.
- It runs before `response:send`, which then sees whatever this returns.

### `response:send`

Filters the finished response of a dispatched request, just before it returns to the transport:

```ts
// boot/no-store.ts
import { hook } from 'ohnejs';

hook('response:send', (response, event) => {
  if (event.url.pathname.startsWith('/api/')) {
    response.headers.set('Cache-Control', 'no-store');
  }
});
```

- It fires for every dispatched outcome: a handler result, a middleware short-circuit, a mapped
  `HTTPError`, the generic `500`, the timed-out `503`.
- A router miss (`404`/`405`) never enters dispatch and skips it. Use
  [`response:headers`](#responseheaders) to cover those too.

### `response:headers`

Filters a response's outgoing headers, the last step before they are written to the socket. Set or
remove a header in place, or return a replacement `Headers`:

```ts
// boot/security-headers.ts
import { hook } from 'ohnejs';

hook('response:headers', (headers) => {
  headers.set('X-Frame-Options', 'DENY');
  headers.set('X-Content-Type-Options', 'nosniff');
});
```

- Unlike `response:send`, it covers every response, including those that never enter dispatch: a
  router `404`/`405`, a rejected-host `400`, a base-path miss.
- The read-only `response` is passed so you can read the status.

## Writing records

These hooks fire around [create, update, and delete](../database/writing.md):

- Most run inside the write [transaction](../database/engine.md#transactions), so a callback that
  writes on the passed `tx` commits atomically with the change, or not at all.
- Each carries a `ctx` that names the `collection`, so check it to target one collection.

### `record:before-change`

Filters the raw input of a create or update before the pipeline coerces it. One hook covers every
caller, so a timestamps, tenant, or audit layer can set its values on every input:

```ts
// boot/timestamps.ts
import { hook } from 'ohnejs';

hook('record:before-change', (input, ctx) => {
  input.updatedAt = new Date().toISOString();
  if (ctx.operation === 'create') input.createdAt = input.updatedAt;
});
```

- It fires once per record, for both operations, inside the transaction, before the input is
  frozen.

### `record:validate`

Filters the field errors of a create or update. Use it to add the cross-field or cross-collection
failures that the [per-field validator](../database/writing.md#sanitizers-and-validators) cannot
express:

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

- It fires after coercion, before any precheck or write, inside the transaction.
- The threaded value is the errors so far, keyed by field path. Spread it to add keys, or return
  your own to replace it.
- A non-empty result aborts the write as
  [`{ ok: false, errors }`](../database/writing.md#the-result), and nothing is written. Returning
  `undefined` or an empty map lets the write continue.
- Read the coerced values from `scope.values`.

### `record:after-create`

Filters a freshly created record, re-read in its final state, just before the create returns. A
search-index, revision, or audit write here commits atomically with the record:

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

- It fires inside the transaction.
- Return a replacement record to reshape what the caller receives.
- The `ctx` carries the `collection`, the open `tx`, and the effective `locale`.

### `record:after-update`

Runs for each record an update touched, re-read in its final state. Use it to write something
atomically for each record, like a search-index row or a revision, on the same `tx`:

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

- It fires once per matched record, inside the transaction, so it is genuinely per-row.
- It is an action: the record passes through unchanged.

### `record:condition`

Filters the `WHERE` condition of an update or delete before it finds the rows it touches. Return a
narrowed condition to force a scope on the write, such as a tenant filter or a soft-delete guard:

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

- It fires once per update or delete call, not per row, outside the transaction.
- The condition is a `ConditionNode` from `ohnejs/utils`. Combine your clause with it using AND and
  return the new node, or return nothing to leave the caller's condition as is.

### `record:before-delete`

Runs just before a delete removes its rows, carrying the `UUID`s of the rows it will remove. Use it
to clean up rows [outside the cascade](../database/collections.md#one-reference), such as an
external mirror or a derived table, on the same `tx`:

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

- It fires inside the transaction.
- The `ctx` carries the `collection`, the scoped `condition`, the `matched` UUIDs, and the open
  `tx`.
- It fires only when it or `record:committed` has a callback registered. Without one, the fast
  delete never lists the rows it removes.
- A [`deleteTranslation`](../database/translations.md#deleting-translations) never fires it, since
  every record it matches survives.

### `record:committed`

Runs after a self-owned write commits. A write is self-owned when it opens its own transaction. Use
it for external effects that must never run on a rollback. Clearing a cache, calling a webhook, or
updating an external index is safe here:

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

- It fires after the commit, outside the transaction.
- A joined [`.use(tx)`](../database/engine.md#transactions) write skips it: the effect is left to
  whoever owns the outer commit.
- The payload carries the `collection`, the `operation`, and the affected `uuids`.
- A `deleteTranslation` reports an `update` of the records that lost the locale.

## Reading records

These hooks fire around [reads](../database/queries.md). They scope the query before it runs and
shape the rows after. Their payloads are typed `QueryIR` and `QueryRecord`: import those from
`ohnejs` to type a callback you declare separately from its `hook` call.

- `query:records` and `query:complete` fire only for reads that return records.
  [`count`, `exists`](../database/queries.md#counting-and-checking), and `pluck`'s column path
  return a scalar and fire neither.
- Junction `UUID` lists, child composites, and blocks load outside both `query:filter` and
  `populate:targets`, so neither hook sees them.

### `query:filter`

Filters the frozen `QueryIR` before a read compiles it to SQL, so one scope reaches every read. Add
a scoping condition with AND here: a tenant key, a soft-delete `deletedAt IS NULL`, an ACL clause.

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

- It fires once per SQL statement: `findMany`, `findFirst`, `count`, `exists`, and `pluck`'s column
  path. A `paginate` fires it twice, once for its count and once for its rows.
- The `QueryIR` is frozen, so mutating it throws. Spread it, add your clause to `condition`, wrapped
  in an `and` when a condition already exists, and return the rebuilt IR.
- It does not reach populated targets. Use [`populate:targets`](#populatetargets) to scope populated
  relations.

### `query:records`

Filters the whole assembled rowset once, after hydrate and populate, just before a row read returns.
Add computed fields, remove sensitive output, or decrypt values that are encrypted at rest:

```ts
// boot/redact-users.ts
import { hook } from 'ohnejs';

hook('query:records', (records, { collection }) => {
  if (collection !== 'Users') return;
  for (const record of records) delete record.passwordHash;
});
```

- It fires for `findMany`, `findFirst`, and `pluck`'s record fallback.
- It runs once over the array, never per row.
- The `context` carries the `collection` and the resolved `ir`.

### `query:complete`

Runs once when a row read finishes, carrying its timing and shape. It is an action for logging or
metrics:

```ts
// boot/slow-reads.ts
import { hook } from 'ohnejs';

hook('query:complete', ({ collection, rowCount, durationMs }) => {
  if (durationMs > 100) {
    console.warn(`slow read on ${collection}: ${rowCount} rows in ${durationMs}ms`);
  }
});
```

- It fires for every read that returns records, including `pluck`'s record fallback. To time
  `count`, `exists`, and `pluck`'s column path, measure at the database adapter.
- `durationMs` spans compile, query, hydrate, populate, and `query:records`, on the monotonic clock.
- `rowCount` is the returned count after every transform.

### `populate:targets`

Filters the target records a populate node has just read in a batch, before they are attached to
their parents. Drop a soft-deleted or unauthorized target here:

```ts
// boot/populate-scope.ts
import { hook } from 'ohnejs';

hook('populate:targets', (targets, { collection }) => {
  if (collection !== 'Posts') return;
  return targets.filter((target) => target.deletedAt === null);
});
```

- A dropped target leaves a `record` link `null` and removes a `records` element, and its whole
  subtree disappears with it.
- Return the filtered `QueryRecord[]`, or nothing to keep every target.
- The `context` carries the populate `node` and its target `collection`.
- It covers only `record` and `records` populates.

## Schema

### `schema:synced`

Runs after the database [schema sync](../database/sync.md#what-happens-at-boot) commits, carrying
the run's `GuardReport`, a type you can import from `ohnejs`. Rebuild a search index, refresh a
cache, or write an audit trail:

```ts
// boot/sync-audit.ts
import { hook } from 'ohnejs';

hook('schema:synced', async (report) => {
  if (report.deletions.length > 0) {
    await notifyOps(`schema sync purged rows:\n${report.deletions.join('\n')}`);
  }
});
```

- The report lists only destructive outcomes: `deletions` are rows deleted under
  [force or a migration](../database/sync.md#force), and `warnings` are orphan rows left in place.
- A clean sync that only creates or alters tables reports both as empty, but still fires.
- It fires under both [`ohne serve api`](../project/cli.md#ohne-serve) and
  [`ohne sync`](../project/cli.md#ohne-sync), but never on a dry run, which commits nothing.

## The dashboard

### `dashboard:menu`

Filters the [sidebar menu](../dashboard/pages.md#the-sidebar) after
[`dashboard.menu`](../project/config.md#the-dashboard) resolves, just before `GET /dashboard`
answers. The groups arrive resolved, so a layer can append a group without knowing the config.

Collection rows are already scoped to
[what the user may reach](../auth/roles.md#the-collections-api-guard). A declared link is not,
because the dashboard has no [capability](../auth/roles.md#capabilities) for a page. This hook is
where you scope one:

```ts
// boot/menu.ts
import { hook } from 'ohnejs';

hook('dashboard:menu', (menu, { user }) => {
  if (user.roles.includes('admin')) {
    menu.push({ label: 'Ops', items: [{ to: '/audit', label: 'Audit log', icon: 'history' }] });
  }
});
```

- It fires once per discovery read, inside the request context, so the viewer's language is
  available.
- Every row already carries a `to`, a translated `label`, and any icon.
- The threaded value is a `DashboardMenuGroup[]`.
- The `context` also carries `collections`: the collections the user can access, as the same read
  describes them. You can build a group from the registered collections instead of naming each one.

## Declaring your own

A layer declares a hook by augmenting the `Hooks` interface. Name it `group:name` in kebab-case, and
type it as its callback signature:

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

The declaration types both ends: `hook` checks callbacks against it, and firing it takes the
declared parameters.

- A callback that returns a value makes it a filter.
- One that returns `void` makes it an action.

`applyHook` fires it: every registered callback runs in order, the first argument threads through
their returns, and the final value comes back. An action fires the same way, just without using the
result.

```ts
import { applyHook } from 'ohnejs';

const name = await applyHook('report:filename', 'report.csv', new Date());
// -> '2026-07-21-report.csv'
```

With no callbacks registered, `applyHook` returns the first argument unchanged, so firing a hook
nobody listens to costs nothing and breaks nothing.
