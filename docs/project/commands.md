# Commands

A command adds a word to `ohne` for work that runs outside a request: seeding the database, an
import, a nightly cleanup. Each `.ts` file in `commands/` is one command, and the file names it:

```ts
// commands/seed.ts
import { query } from 'ohnejs';
import { defineCommand } from 'ohnejs/utils/cli';

export default defineCommand({
  meta: { name: 'seed', description: 'Add the first post.' },
  async run() {
    await query('Posts').create({ title: 'Hello' });
  },
});
```

`npx ohne seed` runs it, and `npx ohne --help` lists it with its description.

## Names

The file name, in kebab-case, is the command's name:

```text
commands/
├── _posts.ts       a helper, not a command
├── feed/           anything you like, never scanned
├── feed.ts         ohne feed
└── importPosts.ts  ohne import-posts
```

- `meta.name` must match the file name.
- A file named like a built-in, such as `dev.ts`, never runs.
- [`dirs.commands`](./config.md#directories) moves the directory.

## Flags

`args` declares the command's flags, and `run` receives their values, typed:

```ts
// commands/seed.ts
import { defineCommand } from 'ohnejs/utils/cli';

export default defineCommand({
  meta: { name: 'seed', description: 'Add sample posts.' },
  args: {
    count: { type: 'number', default: 10, description: 'How many posts to add.' },
    dryRun: { type: 'boolean', description: 'Print the posts instead.' },
  },
  async run({ values }) {
    console.log(values.count, values.dryRun);
  },
});
```

- A camelCase key is a kebab-case flag, so `dryRun` is `--dry-run`.
- `npx ohne seed --help` lists the flags with their descriptions.
- Every command also takes `--cwd` and the [env flags](./env.md#flags), so a command cannot declare
  them.

## Subcommands

A command can group others under `subCommands`, each defined the same way:

```ts
// commands/feed.ts
import { defineCommand } from 'ohnejs/utils/cli';

import exportFeed from './feed/export.ts';
import importFeed from './feed/import.ts';

export default defineCommand({
  meta: { name: 'feed', description: 'Move posts in and out.' },
  subCommands: { import: importFeed, export: exportFeed },
});
```

`npx ohne feed import` runs one. Their files can live in `commands/feed/`.

## What `run` can use

Before `run`, ohne boots your app the way [`ohne serve api`](./cli.md#ohne-serve) does, short of
the port:

- Your [`.env`](./env.md#the-env-file), config, and [boot files](./boot.md) load, and the types
  regenerate.
- The database is connected, so `query` works as it does in a route. The schema is not synced, so
  run [`ohne sync`](./cli.md#ohne-sync) first on a new database.
- `server:ready` never fires. Once `run` ends, even by throwing, every `onShutdown` callback runs,
  then the database closes. Ctrl-C or a `SIGTERM` ends the process at once, and no callback runs.

## Failing

A thrown error prints, and `ohne` exits with `1`. A write that fails validation prints each field
with its reason, and points at the line of yours that made the write. To fail without printing,
set the exit code:

```ts
if (drafts.length > 0) {
  process.exitCode = 1;
  return;
}
```

## Commands in layers

A [layer](./layers.md) ships commands in its own `commands/`, and they appear in every app that
stacks it. `ohnejs/uploads` adds [`ohne uploads prune`](../uploads/storage.md#stray-files) this way.

When two layers ship the same name, the [closer one wins](./layers.md#what-overrides-what) whole.
