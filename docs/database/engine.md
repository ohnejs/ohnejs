# The database

ohne ships with SQLite as its engine, spoken through Node's built-in `node:sqlite` - no driver to
install, no server to run. The first boot creates the database file at `.data/ohne.db` in your
project root, and the [schema sync](./sync.md) shapes it from your collections. A new project has
a working database the moment it starts.

The connection opens during boot, before the sync runs and the port opens, and closes at shutdown
after in-flight requests drain. SQLite runs in WAL mode, so readers run concurrently with a
writer, and foreign keys are enforced.

## Where the database lives

`database.url` in `ohne.config.ts` points the main database at a file. A relative path resolves
against your project root, not the directory you launched from. `:memory:` opens an ephemeral
database that vanishes with the process - handy for a throwaway run:

```ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  database: { url: '.data/app.db' },
});
```

The `DATABASE` [environment variable](../project/env.md) overrides the config for one environment
without touching it; `DB` is an alias. Setting both throws - ohne cannot tell which you meant. The
full precedence is env, then `database.url`, then the default `.data/ohne.db`:

```sh
DATABASE=:memory: pnpm exec ohne dev
```

## Helper databases

Some data does not belong in your main database: rate-limit counters, a cache, anything high-churn
or disposable. `database.helpers` opens additional databases, each keyed by name:

```ts
export default defineConfig({
  database: {
    helpers: { rateLimit: '.data/rate-limit.db' },
  },
});
```

`useDatabase('rateLimit')` returns its connection. The helper names are typed by codegen, so a
typo is a compile error. A helper holds no schema - collections and the sync belong to the main
database alone - so you shape it yourself with raw SQL. Any layer can contribute a helper; when
two name the same one, the closer layer wins.

## Raw SQL

[Read](./queries.md) and [write](./writing.md) your collections through the query builder; raw SQL
is the escape hatch beside it, for a helper database or a table of your own.

`useDatabase()` returns the main connection as a small async adapter - the same surface a helper
has. Statements are parametrized with positional `?` placeholders:

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

- `exec` runs one or more statements with no parameters and no result - DDL and pragmas.
- `run` runs a single write and reports `{ changes }`, the number of rows it touched.
- `query` returns every row; `queryOne` the first, or `undefined` when there are none.

A table you create yourself is foreign to the [schema sync](./sync.md): it is recognized as not
ohne's and never dropped. Keep its name clear of your collections' tables - a collision refuses
the boot.

## Transactions

`transaction` runs a function against the same surface, committing when it returns and rolling
back when it throws:

```ts
await useDatabase().transaction(async (tx) => {
  await tx.run('UPDATE accounts SET balance = balance - ? WHERE id = ?', [100, 'a']);
  await tx.run('UPDATE accounts SET balance = balance + ? WHERE id = ?', [100, 'b']);
});
```

`tx` exposes `exec`, `run`, `query`, and `queryOne` - everything except opening a nested
transaction or closing the connection.

The query builder joins an open transaction with `use`. A [write](./writing.md) then runs inside
it instead of opening its own, so builder writes and raw statements commit or roll back together:

```ts
import { query, useDatabase } from 'ohnejs';

await useDatabase().transaction(async (tx) => {
  const author = await query('Authors').use(tx).createOrThrow({ name: 'Rams' });
  await query('Posts').use(tx).createOrThrow({ title: 'Less, but better', author: author.UUID });
});
```

If the second create fails, the first rolls back with it - the author never exists without the
post.

The app holds one connection per database, and transactions on it serialize: a second
`transaction` call waits for the first to settle, so concurrent writes queue rather than collide.
Across processes, a locked database waits under a five-second busy timeout instead of failing at
once.

By default a transaction takes its write lock lazily, on the first write. The builder's own writes
open theirs in `immediate` mode instead, reserving the lock at `BEGIN` so cross-process contention
waits there rather than failing mid-transaction. Pass `'immediate'` as the second argument when
your own transaction writes:

```ts
await useDatabase().transaction(async (tx) => {
  await tx.run('DELETE FROM hits WHERE count = ?', [0]);
}, 'immediate');
```

## Outside the app

A cron job or a one-off maintenance task runs outside the server, so nothing opens the connection
for it. Open it yourself:

```ts
// scripts/prune-hits.ts
import {
  bootLayers,
  closeDatabases,
  connect,
  loadLayers,
  loadProjectEnv,
  useDatabase,
  withLock,
} from 'ohnejs';

await loadProjectEnv(process.cwd());
await loadLayers();
await bootLayers();
await connect();

try {
  await withLock('hits:prune', () => useDatabase().run('DELETE FROM hits WHERE count = ?', [0]));
} finally {
  await closeDatabases();
}
```

- `loadProjectEnv` reads the project `.env`, so `DATABASE` may live there.
- `loadLayers` resolves your config and every layer it stacks.
- `bootLayers` runs your [boot files](../project/boot.md), so a dialect a layer registers is in
  place for `connect`.
- `connect` opens the main database and every helper.
- `closeDatabases` closes them, whether the work succeeds or throws.

Your collections are not registered in such a script, so `query` throws `Unknown collection`. Use
[raw SQL](#raw-sql) there. The [cluster lock](./with-lock.md) needs no sync first: it creates its
table on its first bid.

Run the script from the project root, with ohne's `register` hook so Node can load ohne's
TypeScript from `node_modules`:

```sh
node --import ohnejs/register scripts/prune-hits.ts
```

The hook and `process.cwd()` both resolve from where you launch, so a cron entry changes into the
project first. A cron job also starts with a bare environment. If your app takes `DATABASE` from
its host, pass the same value; without it the script opens `database.url` or `.data/ohne.db`, and
the lock guards a database your app never reads:

```sh
cd /srv/app && DATABASE=/srv/data/app.db node --import ohnejs/register scripts/prune-hits.ts
```

## Reserved tables

ohne keeps its own state in three tables in the main database: `ohne_locks` backs the
[cluster lock](./with-lock.md), `ohne_migrations` records which [migrations](./migrations.md) ran,
and `ohne_schema` holds the sync's schema snapshot. A table rebuild briefly parks the old table
under an `ohne_rebuild_` prefix. The framework manages all of them itself; leave the `ohne_`
prefix alone in your own SQL.

## Other dialects

SQLite is the built-in dialect, but the engine speaks to the database only through the `Dialect`
abstract class - the one place a driver and its SQL live. A layer adds another engine by
registering a `Dialect` instance with `useDialects()` from a [boot file](../project/boot.md) and
augmenting `KnownDialects` with its name; `database.dialect` in config then selects it. The
class's abstract members - connecting, quoting, type mapping, applying a schema diff - are the
whole contract, so an incomplete dialect fails to compile rather than at runtime.
