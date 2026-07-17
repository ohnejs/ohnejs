# Migrations

[Schema sync](./sync.md) handles everyday changes by itself: you edit a collection, the next boot
reshapes the database. Its destructive guard refuses any change that would lose data - and most
real changes are not losses, they are moves. A migration expresses the move: it tells the sync
where the data goes, the data goes there, and the guard has nothing left to refuse.

A migration is one declarative operation - a move, a rename, a discard, or a switch - not a script
of SQL. You describe the change; the engine carries the rows.

## A migration file

One file under `migrations/`, default-exporting `defineMigration`. Renaming a field is a move: the
new column takes the values, the old column drops.

```ts
// migrations/2026-07-14-draft.ts
import { defineMigration } from 'ohne';

export default defineMigration({
  from: { collection: 'Posts', field: 'isDraft' },
  to: { collection: 'Posts', field: 'draft' },
});
```

Rename the field in `collections/Posts.ts` in the same change; the migration covers the data, the
sync covers the structure.

Files run in file name order, so a date prefix keeps them in the order you wrote them. A
`_`-prefixed file or directory is a helper and is skipped. The directory is per layer -
`dirs.migrations` in [config](../project/config.md) - and a layer's migrations run before the
app's own.

## Addresses

`from` and `to` are addresses. The logical form names a collection and a field path:

```ts
{ collection: 'Posts', field: 'title' }
{ collection: 'Posts', field: 'sections.title' } // inside a composite
{ block: 'Hero', field: 'title' }                // a block's field
```

The path descends composites with dots; the last segment is the column. A `from` may name a
collection or field that no longer exists in your code - that is the point: the code has moved on,
and the migration addresses the data left behind.

An optional `type` asserts what the column holds live - `'text'`, `'integer'`, `'boolean'`, or
`'json'`. A mismatch is a hard error naming the drift, never a silent skip.

The physical form names a raw table and column, for the corners the logical naming cannot reach:

```ts
{ table: 'Posts', column: 'isDraft', type: 'text' }
```

One migration uses one form: logical pairs with logical, physical with physical.

## Moving values

A move carries one column's values onto another - across fields, across collections, retyped on
the way. `transform` runs once per row; omitted, each value carries unchanged:

```ts
// migrations/2026-07-14-draft.ts
import { defineMigration } from 'ohne';

export default defineMigration({
  from: { collection: 'Posts', field: 'isDraft' },
  to: { collection: 'Posts', field: 'draft' },
  transform: (value) => value === 'yes',
});
```

The value arrives as the old type and the return is stored as the new one, so a retype is just a
transform returning the new shape. The transform also receives the full row and a `ctx` with
read-only `query` and `queryOne` for lookups mid-migration - await them.

A move across tables must know which row receives which value. Rows correlate by their shared
primary key, or through the parent link when a field moves into or out of an `object` composite -
a missing object row is created on the way in. A source row with no target row would silently
lose its value, so the move refuses instead.

## Renaming

A rename with no field renames the whole collection. Every owned table follows - junctions, child
tables, the translations table - and constraints recreate under the new name.

```ts
// migrations/2026-08-01-articles.ts
import { defineMigration } from 'ohne';

export default defineMigration({
  from: { collection: 'Posts' },
  to: { collection: 'Articles' },
});
```

A [block](./blocks.md) renames the same way, and every stored reference to the type follows:

```ts
// migrations/2026-08-02-banner.ts
import { defineMigration } from 'ohne';

export default defineMigration({
  from: { block: 'Hero' },
  to: { block: 'Banner' },
});
```

You never pick move or rename by hand. A `from`/`to` field pair is a move over a plain column and
a rename over a composite's table: renaming a repeater field carries its table, not its values,
because the values already sit where they belong.

## Discarding

`to: null` drops data on purpose: a field, a composite, or a whole collection. The discard is the
authorization - it never needs force.

```ts
// migrations/2026-08-10-drop-legacy.ts
import { defineMigration } from 'ohne';

export default defineMigration({
  from: { collection: 'Posts', field: 'legacy' },
  to: null,
});
```

A block address discards a field inside the block; removing a whole block type stays with
[force](./sync.md#force).

## Switching an attribute

A switch flips one schema attribute of one field: `nullable`, `unique`, `uniquePerLocale`, or
`translatable`. The flag on `from` asserts the live state; the flipped state comes from your
collection code, so `to` is usually omitted. One migration flips one attribute; chain files for
more.

The switch's job is the data the new state needs. Making a field required would refuse over rows
holding `NULL`; a backfill satisfies the guard:

```ts
// migrations/2026-09-01-category-required.ts
import { defineMigration } from 'ohne';

export default defineMigration({
  from: { collection: 'Posts', field: 'category', nullable: true },
  transform: (value) => value ?? 'general',
});
```

The transform runs once per row: return a value to write it, nothing to keep the row untouched, or
`ctx.deleteRecord()` to delete the row whole - how a `unique` switch resolves duplicates. The
structural change itself stays with the sync's diff; the switch prepares the rows it will probe.

Turning a field [translatable](./translations.md) needs no migration: the engine moves the
existing values onto the default locale by itself, losslessly. Turning it off must pick which
locale survives, and that is a switch:

```ts
// migrations/2026-10-01-title-per-post.ts
import { defineMigration } from 'ohne';

export default defineMigration({
  from: { collection: 'Posts', field: 'title', translatable: true },
  transform: (value, row, ctx) => {
    if (ctx.locale === 'en') return value;
    return ctx.deleteRecord();
  },
});
```

This runs once per record and locale: return a value to promote it onto the record, or delete the
locale's row. Without a transform the default locale's value promotes.

## When migrations run

Migrations run inside the sync's transaction, before the structural diff, at
[boot or `ohne sync`](./sync.md#what-happens-at-boot). Constraints on every touched table come
down first, so a migration writes freely; the diff then reshapes the migrated structure and puts
them back, each addition probed by the guard. One transaction covers it all: a refusing migration
rolls back everything, the boot fails, and the database is exactly what it was.

## Each migration runs once

An executed migration is stamped by name - `<layer>/<file stem>` - in the database, and a stamped
migration never runs again. The file stays in your repo as history, and its name is its identity:
renaming a shipped file makes it a new migration.

A fresh database never replays history. Where a migration's `from` does not exist and its `to` is
already satisfied - by the live schema, your collections, or a later migration in the chain - it
stamps as skipped, so old migrations skip end to end and the sync builds the current schema
directly.

A `from` that is absent while `to` is satisfied nowhere refuses: the migration is stale or
mistyped, and the error says which.

## Rehearsing

`ohne sync --dry-run` runs your migrations for real - transforms included - against the live
database, together with the diff and the guard, then rolls everything back:

```sh
pnpm exec ohne sync --dry-run
```

A migration that would refuse fails the dry run exactly where it would fail the boot, which makes
it the place to test a transform before it touches anything. See
[syncing without serving](./sync.md#syncing-without-serving).
