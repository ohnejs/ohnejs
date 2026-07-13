# Schema sync

You declare what the database should look like; ohne makes it so. At every boot the schema sync
compares the live database against your collections and applies the difference: new tables are
created, new columns added, removed ones dropped. For everyday changes there is nothing else to do -
no migration files, no SQL.

## Declaring a collection

A collection is one file under `collections/`, named after it:

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohne';

export default defineCollection({
  fields: {
    title: field('text'),
    views: field('integer', { nullable: true }),
  },
});
```

The file's path names the collection: `collections/Posts.ts` becomes the `Posts` table. A
subdirectory joins the name - `collections/blog/Posts.ts` becomes `BlogPosts` - and a
`blog/index.ts` collapses to `Blog`. Names normalize to PascalCase; field names are camelCase.

Every collection gets two columns you never declare: `UUID`, the text primary key, and
`_updatedAt`, an internal timestamp. Your fields become the other columns. A field is `NOT NULL`
unless you pass `nullable: true`.

A `_`-prefixed file or directory inside `collections/` is a helper and is ignored, so shared
snippets can live beside your collections.

## Uniques and indexes

Field options cover the single-column cases:

```ts
fields: {
  email: field('text', { unique: true }),
  author: field('text', { index: true }),
}
```

`unique` covers `index` - a unique index serves plain lookups too, so setting both emits the
unique index alone.

Constraints over several columns live on the collection, one entry per constraint:

```ts
export default defineCollection({
  fields: {
    email: field('text'),
    tenant: field('text'),
  },
  compositeIndexes: [{ fields: ['email', 'tenant'], unique: true }],
});
```

`fields` lists your field names in order. With `unique: true` the entry is a unique constraint,
without it a plain index.

## What happens at boot

The sync runs inside the server boot, after your collections are registered and before the port
opens. A failed sync means the app does not serve - the database is never half-migrated behind a
live socket.

The engine introspects the live database, diffs it against your collections, and applies the
difference inside one transaction. When several instances of the app boot at once, a cluster lock
elects one to sync; the others wait and then boot against the finished schema.

## The destructive guard

The sync never destroys data silently. It refuses to boot when a change would lose something:

- dropping a table or column that still holds rows,
- changing the type of a populated column,
- adding a unique constraint over duplicate values,
- adding `NOT NULL` where rows hold `NULL`.

The refusal names exactly what would be lost. Empty tables and all-`NULL` columns are dropped
freely - there is nothing to lose.

An intentional change is expressed as a migration: a file under `migrations/` built with
`defineMigration`, moving, renaming, or discarding data. Migrations run inside the same sync
transaction, before the diff, so a covered change passes the guard.

## Force

`FORCE_SYNC` (or its `--force-sync` flag, or `database.sync.force` in config) authorizes the guard's
deletions for one boot:

```sh
FORCE_SYNC=1 pnpm serve:api
pnpm serve:api --force-sync
```

Force does not skip the checks - it performs the deletions they warned about, and reports
everything it deleted in one block. Reach for a migration first; force is for the cases where the
data is truly disposable.

## Rolling back

Rolling back the code rolls the schema with it: the next boot reconciles the database back to
what the old build declares, and the destructive guard treats that like any other change. A
rollback that only removes empty additions syncs freely. One that would lose data refuses until
a migration covers it - a move carrying values back, a discard declaring them disposable - or
force authorizes it.

If you need the old data too, restore the database backup together with the old code.

## Syncing without serving

`ohne sync` runs the same sync as the server boot and exits - no port opens:

```sh
pnpm exec ohne sync
```

Use it as a deploy step: stop the app, sync, start the new build. A guard refusal then fails the
deploy instead of the first boot, and you see it before anything serves. `--force` authorizes the
destructive changes, exactly like `FORCE_SYNC`:

```sh
pnpm exec ohne sync --force
```

A database already in shape makes the command a no-op, so it is always safe to run.
