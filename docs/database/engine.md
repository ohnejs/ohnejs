# The database engine

ohne ships with SQLite as its engine and uses it through Node's built-in `node:sqlite`. There is no
driver to install and no server to run. The first boot creates the database file at `.data/ohne.db`
in your project root, and the [schema sync](./sync.md) creates its tables from your collections. A
new project has a working database as soon as it starts.

- SQLite runs in WAL mode, so readers run at the same time as a writer.
- Foreign keys are enforced.
- The connection opens during boot, before the sync, and closes at shutdown after the running
  requests have finished.

## Where the database lives

`database.url` in `ohne.config.ts` points the main database at a file. A relative path resolves
against your project root, not the directory you launched from. `:memory:` opens a temporary
database that is gone when the process ends. That is useful when you do not need to keep the data:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  database: { url: '.data/app.db' },
});
```

The main database comes from the first of these that is set:

1. The `DATABASE` [environment variable](../project/env.md#the-built-ins), or its alias `DB`.
   Setting both throws, since ohne cannot tell which you meant.
2. `database.url` in config.
3. The default, `.data/ohne.db`.

```sh
DATABASE=:memory: npx ohne dev
```

## Helper databases

Some data does not belong in your main database: a cache, a scratch table, anything that changes
very often or that you can throw away. `database.helpers` opens additional databases, each under its
own name:

```ts
// ohne.config.ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
  database: {
    helpers: { cache: '.data/cache.db' },
  },
});
```

`useDatabase('cache')` returns its connection.

- Helper names are typed by codegen, so a typo is a compile error.
- A helper has no schema. Collections and the sync belong only to the main database, so you create a
  helper's tables yourself with [raw SQL](#raw-sql).
- Any layer can add a helper. When two layers use the same name, the closer layer wins.

## Raw SQL

[Read](./reading.md) and [write](./writing.md) your collections through the query builder. Raw SQL
is for what the builder does not cover: a helper database or a table of your own.

`useDatabase()` returns the main connection as a small async adapter. A helper has the same methods.
Statements take their values through positional `?` placeholders:

```ts
import { useDatabase } from 'ohnejs';

const db = useDatabase();

await db.exec('CREATE TABLE IF NOT EXISTS hits (path TEXT PRIMARY KEY, count INTEGER NOT NULL)');
await db.run('INSERT INTO hits (path, count) VALUES (?, ?)', ['/home', 1]);

await db.query<{ path: string }>('SELECT path FROM hits');
// -> [{ path: '/home' }]

await db.queryOne<{ count: number }>('SELECT count FROM hits WHERE path = ?', ['/home']);
// -> { count: 1 }
```

- `exec` runs one or more statements with no parameters and no result. Use it for DDL and pragmas.
- `run` runs a single write and returns `{ changes }`, the number of rows it changed.
- `query` returns every row.
- `queryOne` returns the first row, or `undefined` when there are none.

The [schema sync](./sync.md) sees that a table you create yourself is not ohne's, and never drops
it. Give it a name that none of your collections' tables use, because ohne refuses to boot when the
names are the same.

## Transactions

`transaction` runs a function and passes it the same methods. It commits when the function returns
and rolls back when it throws:

```ts
await useDatabase().transaction(async (tx) => {
  await tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 'a']);
  await tx.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 'b']);
});
```

`tx` has `exec`, `run`, `query`, and `queryOne`. That is everything except opening a nested
transaction or closing the connection.

The query builder joins an open transaction with `use`. A [write](./writing.md) then runs inside
it instead of opening its own, so builder writes and raw statements commit or roll back together:

```ts
import { query, useDatabase } from 'ohnejs';

await useDatabase().transaction(async (tx) => {
  const author = await query('Authors').use(tx).createOrThrow({ name: 'Thrall' });
  await query('Posts').use(tx).createOrThrow({ title: 'For the Horde', author: author.UUID });
});
```

If the second create fails, the first rolls back with it, so the author never exists without the
post.

The app holds one connection per database, and transactions on it run one after another. A second
`transaction` call waits until the first has finished, so writes that arrive at the same time wait
in a queue instead of colliding. When another process holds the database locked, a write waits up to
five seconds instead of failing at once.

If your own transaction writes, pass `'immediate'` as the second argument. It takes the write lock
at `BEGIN` and waits there, instead of failing in the middle of the transaction. The builder's own
writes already do this:

```ts
await useDatabase().transaction(async (tx) => {
  await tx.run('DELETE FROM hits WHERE count = ?', [0]);
}, 'immediate');
```

## Outside the app

A cron job or a one-time maintenance task runs outside the server. Write it as a
[command](../project/commands.md), and ohne connects the database for it:

```ts
// commands/prune-hits.ts
import { useDatabase, withLock } from 'ohnejs';
import { defineCommand } from 'ohnejs/utils/cli';

export default defineCommand({
  meta: { name: 'prune-hits', description: 'Delete the hits nobody counted.' },
  async run() {
    await withLock('hits:prune', () => useDatabase().run('DELETE FROM hits WHERE count = ?', [0]));
  },
});
```

A cron job starts with an almost empty environment, and only the project's
[`.env`](../project/env.md#the-env-file) fills it. Pass any `DATABASE` your app gets elsewhere, or
the lock protects a database your app never reads:

```sh
cd /srv/app && DATABASE=/srv/data/app.db npx ohne prune-hits
```

## Reserved tables

ohne keeps its own state in the main database, in tables prefixed `ohne_`. The framework manages
them itself, so do not use the prefix in your own SQL:

- `ohne_locks` stores the data for the [cluster lock](./locks.md).
- `ohne_rate_limits` counts [rate limits](../api/rate-limiting.md#across-processes), in the helper
  database you name for them.
- `ohne_migrations` records which [migrations](./migrations.md#each-migration-runs-once) ran.
- `ohne_schema` holds the sync's schema snapshot.

## Other dialects

SQLite is the built-in dialect. The engine uses the database only through the `Dialect` abstract
class. It is the only place that contains a driver and its SQL. To add another engine:

1. A layer registers a `Dialect` instance with `useDialects()` from a
   [boot file](../project/boot.md#registering-a-dialect).
2. It augments `KnownDialects` with the dialect's name.
3. [`database.dialect`](../project/config.md#the-database) in config selects it.

The class's abstract members are the whole contract: connecting, quoting, type mapping, applying a
schema diff. So an incomplete dialect fails to compile instead of failing at runtime.
