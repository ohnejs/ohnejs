# Boot files

A boot file is a `.ts` file at the top level of `boot/` - the `dirs.boot` directory from
[config](./config.md). It runs once at startup, by being imported: whatever its module body does
happens before the app serves. Use it for startup registrations - anything that must exist before
the first request.

The most common registration is a [hook](../api/hooks.md):

```ts
// boot/ready.ts
import { hook } from 'ohne';

hook('server:ready', ({ host, port }) => {
  console.log(`accepting connections at http://${host}:${port}`);
});
```

There is nothing to export and nothing to call - importing the file is the whole mechanism.

## When they run

Boot files run right after the layer stack loads: before types regenerate, before the
[schema sync](../database/sync.md), and before the port opens. Whatever a boot file registers is
in place for everything that follows, and a throw aborts startup before anything serves.

They run wherever the schema and the API do: under `ohne serve api`, under `ohne dev` - every
reload is a fresh process, so boot runs again - and under `ohne sync`, which needs the dialect a
boot file may register. The dashboard server does not run them.

## Ordering

Within one `boot/` directory, every top-level `.ts` file runs, sorted naturally by name - `2-`
before `10-` - and each file finishes before the next starts. Nested files are ignored, and a
`_`-prefixed file is a helper: skipped by the scan, free to be imported by the others.

An `index.ts` takes over: when present it is the only file that runs, and it orders the rest by
importing them itself.

Across [layers](./layers.md), the furthest layer boots first - a base layer's registrations are
already in place when your boot files run, and its hooks fire ahead of yours. Each layer reads
its own `dirs.boot`.

## Registering a dialect

A boot file is where a layer teaches the database a new dialect: register the implementation and
augment `KnownDialects` so config accepts the name. See [the engine](../database/engine.md) for
what a dialect drives.

```ts
// boot/dialect.ts
import { useDialects } from 'ohne';

import { PostgresDialect } from '../database/postgres.ts';

declare module 'ohne' {
  interface KnownDialects {
    postgres: true;
  }
}

useDialects().register('postgres', new PostgresDialect());
```

Registering an existing name overrides it, so a dialect from a closer layer wins - the same
furthest-first order that lets your app overrule a base layer.
