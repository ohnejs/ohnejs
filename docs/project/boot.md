# Boot files

A boot file is a `.ts` file at the top level of `boot/`. It runs once at startup, before the app
serves. Use it for anything that must exist before the first request. `dirs.boot` in
[config](./config.md#directories) moves the directory elsewhere.

The most common registration is a [hook](./hooks.md#registering):

```ts
// boot/ready.ts
import { hook } from 'ohnejs';

hook('server:ready', ({ host, port }) => {
  console.log(`accepting connections at http://${host}:${port}`);
});
```

There is nothing to export and nothing to call, and nothing imports the file either. ohne finds it
at startup and imports it for you. That import runs the code at its top level, which is all a boot
file needs.

## When they run

Boot files run right after the layer stack loads: before types [regenerate](./cli.md#ohne-prepare),
before the [schema sync](../database/sync.md#what-happens-at-boot), and before the port opens.
Whatever a boot file registers is in place for everything that follows. If a boot file throws,
startup stops before anything serves.

They run under [`ohne serve api`](./cli.md#ohne-serve), [`ohne dev`](./cli.md#ohne-dev) (again on
every reload), and [`ohne sync`](./cli.md#ohne-sync), which needs any dialect a boot file registers.
The dashboard server does not run them.

## Ordering

Within one `boot/` directory:

- Every top-level `.ts` file runs, sorted naturally by name, so `2-` runs before `10-`. Each file
  finishes before the next starts.
- Nested files are ignored.
- A `_`-prefixed file is a helper. The scan skips it, and the other files can import it.
- An `index.ts` takes over. When present, it is the only file that runs, and it imports the rest in
  its own order.

Across [layers](./layers.md#the-stack), the furthest layer boots first. A base layer's registrations
are in place when your boot files run, and its hooks fire before yours. Each layer reads its own
`dirs.boot`.

## Registering a dialect

A boot file is where a layer adds a new dialect to the database: register the implementation and
augment `KnownDialects` so [config](./config.md#the-database) accepts the name.
[Other dialects](../database/engine.md#other-dialects) covers what a dialect does.

```ts
// boot/dialect.ts
import { useDialects } from 'ohnejs';

import { PostgresDialect } from '../database/postgres.ts';

declare module 'ohnejs' {
  interface KnownDialects {
    postgres: true;
  }
}

useDialects().register('postgres', new PostgresDialect());
```

Registering an existing name overrides it, so a dialect from a closer layer wins. This is the same
furthest-first order that lets your app override a base layer.
