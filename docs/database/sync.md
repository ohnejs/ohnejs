# Schema sync

You declare what the database should look like, and ohne makes it so. At every boot the schema
sync compares the live database against your [collections](./collections.md) and applies the
difference: new tables are created, new columns added, removed ones dropped. For everyday changes
there is nothing else to do - no migration files, no SQL.

[Files and names](./collections.md#files-and-names) covers how a file names its table, and
[uniques and indexes](./collections.md#uniques-and-indexes) covers the constraints it can declare.

## What happens at boot

The sync runs inside the server boot, after your collections are registered and before the port
opens. When the sync fails, the app does not serve, so no request ever reaches a half-migrated
database.

The engine reads the live schema, diffs it against your collections, and applies the difference
inside one transaction. When several instances of the app boot at once, a
[cluster lock](./locks.md) picks one to run the sync. The others wait, then boot against the
finished schema.

After the sync, each [singleton](./collections.md#singletons) that has no record gets one, created
from its field defaults. Instances booting together create it once.

## The destructive guard

The sync never destroys data silently. It refuses to boot when a change would lose something:

- dropping a table or column that still holds rows,
- changing the type of a column that holds values,
- adding a unique constraint over duplicate values,
- adding `NOT NULL` where rows hold `NULL`,
- adding a relation whose existing values point at no target row.

The refusal names exactly what would be lost. Empty tables and all-`NULL` columns are dropped
freely, since there is nothing to lose.

To make an intentional change, write a [migration](./migrations.md). Migrations run inside the same
sync transaction, before the diff, so a change they cover passes the guard.

## Force

Force allows the deletions the guard refuses:

- `FORCE_SYNC=1`, or its `--force-sync` flag, for one boot.
- `database.sync.force` in [config](../project/config.md#the-database), for every boot until you
  remove it.

```sh
FORCE_SYNC=1 npm run serve:api
# or
npm run serve:api -- --force-sync
```

Force does not skip the checks. It performs the deletions they warned about, and reports everything
it deleted in one block. Try a migration first. Force is for data you truly do not need.

Some changes are refused even with force, because force cannot decide which rows to keep:

- a unique constraint over duplicate values,
- `NOT NULL` over rows holding `NULL`,
- a type change into `NOT NULL` on a column that holds values.

Fix the data first, or rewrite it with a migration.

## Rolling back

Rolling back the code rolls back the schema too. The next boot changes the database back to what
the old build declares, and the guard treats that like any other change:

- A rollback that only removes additions that are still empty syncs freely.
- One that would lose data refuses until a migration or force covers it.

If you need the old data too, restore the database backup together with the old code.

## Syncing without serving

`ohne sync` runs the same sync as the server boot and exits, without opening a port. When the
database already matches, it does nothing, so it is always safe to run:

```sh
npx ohne sync
```

`--force` allows the destructive changes, exactly like `FORCE_SYNC`. `--dry-run` runs the whole
sync against the live database, including migrations, diff, and guard, then rolls everything back.

A deploy that changes the schema:

1. Run `npx ohne sync --dry-run` while the old build still serves. A refusal exits with a non-zero
   code, exactly where a real sync would refuse, so a bad schema change fails the pipeline before
   you switch to the new build.
2. Apply the change. Either let the new build's boot sync it, or stop the app, run `npx ohne sync`,
   and start the new build. The second way fails the deploy on a refusal instead of the first boot.
