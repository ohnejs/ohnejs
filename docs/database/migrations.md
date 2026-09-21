# Migrations

A migration tells the [schema sync](./sync.md) where data goes when a change would otherwise lose
it. The sync's [destructive guard](./sync.md#the-destructive-guard) refuses such changes, but most
of them are moves, not losses. Once the migration carries the data, the guard has nothing left to
refuse.

A migration is not a script of SQL. It is one declarative operation: a move, a rename, a discard, or
a switch. You describe the change, and the engine carries the rows.

## A migration file

A migration is one file under `migrations/` that default-exports a `defineMigration` call. Renaming
a field is a move: the new column takes the values, and the old column is dropped.

```ts
// migrations/2026-07-14-draft.ts
import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: { collection: 'Posts', field: 'isDraft' },
  to: { collection: 'Posts', field: 'draft' },
});
```

Rename the field in `collections/Posts.ts` in the same change. The migration covers the data, and
the sync covers the structure.

- Files run in file name order, so a date prefix keeps them in the order you wrote them.
- A `_`-prefixed file or directory is a helper and is skipped.
- Each layer has its own directory, [`dirs.migrations`](../project/config.md#directories), and a
  layer's migrations run before the app's own.

## Moving values

A move carries one column's values onto another. It can cross fields, cross collections, and change
the type on the way. `transform` runs once per row. If you omit it, each value moves unchanged:

```ts
// migrations/2026-07-14-draft.ts
import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: { collection: 'Posts', field: 'isDraft' },
  to: { collection: 'Posts', field: 'draft' },
  transform: (value) => value === 'yes',
});
```

The value arrives as the old type, and what you return is stored as the new type. So to change a
type, return the new shape from the transform. The transform also receives the full row and a `ctx`
with read-only `query` and `queryOne` for lookups during the migration. Await them.

A move across tables must know which row receives which value:

- Rows are matched by their shared primary key.
- A field moving into or out of an [`object`](./field-types.md#object) composite is matched
  through the parent link, and a missing object row is created on the way in.
- A source row with no target row would silently lose its value, so the move refuses instead.

## Renaming

A rename with no field renames the whole collection. Every table the collection owns follows:
junctions, child tables, and the translations table. Constraints are recreated under the new name.

```ts
// migrations/2026-08-01-articles.ts
import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: { collection: 'Posts' },
  to: { collection: 'Articles' },
});
```

A [block](./blocks.md) is renamed the same way, and every stored reference to the type follows:

```ts
// migrations/2026-08-02-banner.ts
import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: { block: 'Hero' },
  to: { block: 'Banner' },
});
```

The same `from`/`to` field pair works for a composite field: its table is renamed and its values
are not copied, because the values are already in the right place.

## Discarding

`to: null` drops data on purpose: a field, a composite, or a whole collection. The discard itself is
the permission, so it never needs force.

```ts
// migrations/2026-08-10-drop-legacy.ts
import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: { collection: 'Posts', field: 'legacy' },
  to: null,
});
```

A block address discards a field inside the block. Removing a whole block type still needs
[force](./sync.md#force).

## Switching an attribute

A switch turns one schema attribute of one field on or off: `nullable`, `unique`,
`uniquePerLocale`, or `translatable`. The flag on `from` asserts the live state, and the new state
comes from your collection code, so you usually omit `to`. One migration switches one attribute. To
switch more, write one file for each.

The switch's job is to fix the data so it fits the new state. The sync refuses to make a field
required while rows hold `NULL`. Fill those rows with a transform, and the guard is satisfied:

```ts
// migrations/2026-09-01-category-required.ts
import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: { collection: 'Posts', field: 'category', nullable: true },
  transform: (value) => value ?? 'general',
});
```

The transform runs once per row:

- Return a value to write it.
- Return nothing to leave the row untouched.
- Return `ctx.deleteRecord()` to delete the whole row, which is how a `unique` switch removes
  duplicates.

The sync still makes the schema change. The switch fixes the data first.

Turning a field [translatable](./translations.md#marking-fields) needs no migration: the engine
moves the existing values onto the default locale by itself, and nothing is lost. When you turn it
off, you must pick which locale is kept, and that is a switch:

```ts
// migrations/2026-10-01-title-per-post.ts
import { defineMigration } from 'ohnejs';

export default defineMigration({
  from: { collection: 'Posts', field: 'title', translatable: true },
  transform: (value, row, ctx) => {
    if (ctx.locale === 'en') return value;
    return ctx.deleteRecord();
  },
});
```

This runs once per record and locale: return a value to store it on the record, or delete the
locale's row. Without a transform, the record keeps the default locale's value.

## Addresses

`from` and `to` are addresses. The logical form names a collection and a field path:

```ts
{ collection: 'Posts', field: 'title' }
{ collection: 'Posts', field: 'sections.title' } // inside a composite
{ block: 'Hero', field: 'title' }                // a block's field
```

Dots in the path step into composites, and the last segment is the column. A `from` may name a
collection or field that no longer exists in your code. That is intended: the code has changed, and
the migration addresses the data left behind.

An optional `type` asserts what the live column holds: `'text'`, `'integer'`, `'real'`, `'boolean'`,
or `'json'`. A mismatch is an error that names the difference, never a silent skip.

The physical form names a raw table and column, for the cases the logical form cannot address:

```ts
{ table: 'Posts', column: 'isDraft', type: 'text' }
```

One migration uses one form: logical pairs with logical, physical with physical.

## When migrations run

Migrations run inside the sync's transaction, before the structural diff, at
[boot or `ohne sync`](./sync.md#what-happens-at-boot). One transaction covers it all: when a
migration refuses, everything rolls back, the boot fails, and the database is exactly as it was.

## Each migration runs once

When a migration has run, its name is recorded in the database as `<layer>/<file stem>`, and a
recorded migration never runs again. The file stays in your repo as history, and its name is its
identity: renaming a shipped file makes it a new migration.

On a fresh database, old migrations skip themselves: their `from` is gone and their `to` already
exists, in the live schema, your collections, or a later migration. The sync then builds the
current schema directly.

When `from` is missing and `to` exists nowhere, the migration refuses. It is stale or mistyped, and
the error says which.

## Rehearsing

[`ohne sync --dry-run`](./sync.md#syncing-without-serving) runs your migrations for real against the
live database, transforms included, then rolls everything back. A migration that would refuse fails
the dry run exactly where it would fail the boot, so it is the place to test a transform before it
touches anything.
