# Environment variables

Environment variables configure a project where it runs: ports, the database, secrets. ohne reads
them through `useEnv()`, and every read is typed, never a raw string:

```ts
import { useEnv } from 'ohnejs';

useEnv().get('PORT');   // number | undefined
useEnv().get('SILENT'); // boolean
```

If a value is invalid, ohne refuses to boot and names the variable: `PORT=abc` fails with
`` `PORT` must be an integer between `0` and `65535` `` instead of serving on an unexpected port.

## The built-ins

| Variable           | Default       | Effect                                                                                                              |
| ------------------ | ------------- | ------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`         | `development` | The runtime environment. `production` and `test` match exactly. Anything else is `development`.                     |
| `PORT`             | -             | Port for the HTTP servers, over `api.port` and `dashboard.port`.                                                    |
| `HOST`             | -             | Host for the HTTP servers, over `api.host` and `dashboard.host`.                                                    |
| `DATABASE`, `DB`   | -             | [Main database](../database/engine.md#where-the-database-lives) URL, over `database.url`.                           |
| `FORCE_SYNC`       | `false`       | Authorizes a destructive [schema sync](../database/sync.md#force) for one boot, over `database.sync.force`.         |
| `COOKIE_SECRET`    | -             | Signs cookies set with [`setSignedCookie`](../api/request.md#signed-cookies). Signed cookies throw until it is set. |
| `SILENT`           | `false`       | Silences all output, over `printer.silent`.                                                                         |
| `DEBUG`            | `false`       | Enables ohne's debug output, over `printer.debug`.                                                                  |
| `NO_COLOR`         | `false`       | Disables ANSI colors.                                                                                               |
| `FORCE_COLOR`      | -             | Forces colors on or off, over terminal detection.                                                                   |
| `SKIP_CODEGEN`     | `false`       | Skips codegen at [startup](./cli.md#ohne-serve), for when a parent process already ran it.                          |
| `DASHBOARD_RELOAD` | `false`       | Serves the dashboard's live-reload stream. [`ohne dev`](./cli.md#ohne-dev) turns it on for you.                     |
| `API_URL`          | -             | Base URL the dashboard's browser client calls, over `dashboard.apiURL`.                                             |
| `DASHBOARD_URL`    | -             | Dashboard origin the API's [CORS](../api/middleware.md#cors) allows, over `dashboard.origin`.                       |

A layer defines its own, such as the uploads layer's
[`UPLOADS_URL`](../uploads/uploads.md#configuration) and
[`UPLOADS_SECRET`](../uploads/private-files.md).

Boolean variables accept `1`, `true`, `0`, and `false`, case-insensitive. A few work differently:

- `NO_COLOR` - any non-empty value disables color, following the no-color.org standard.
- `DEBUG` - a filter matched against the `ohne` namespace, so `DEBUG=1`, `DEBUG=*`, `DEBUG=ohne`,
  and `DEBUG=ohne:*` all enable it.
- `FORCE_COLOR` - `0` or `false` forces colors off, and anything else forces them on.

`DATABASE` and `DB` are aliases. Setting both throws, since ohne cannot tell which you meant.

## Environment beats config

Where the [table above](#the-built-ins) says "over `api.port`", that variable overrides the
[config](./config.md) field it names. A variable that is set wins:

```sh
PORT=4000 npx ohne serve api
```

For any one read, the first source that has a value wins:

1. A CLI flag.
2. The process environment.
3. The project `.env`.
4. The config field.
5. The built-in default.

A variable wins because it is set, not because of its value: `SILENT=0` overrides
`printer: { silent: true }`, even though `0` is the off value.

## The `.env` file

A `.env` next to `ohne.config.ts` holds the variables you would rather not type into the shell,
such as secrets. Every command reads it before anything else runs:

```sh
# .env
DATABASE=.data/dev.db
COOKIE_SECRET=a-long-random-value
```

The file sets only the variables that are still unset, and never overrides one. A variable that the
shell, your host, or CI already set keeps its value, so `PORT=5000 npm run dev` beats a `PORT` in
the file.

There is one file, with no `.env.local` or `.env.production`. In production, set the real
environment and ship no file. The scaffold already gitignores it.

The syntax:

- Each line is `KEY=value`.
- A `#` after whitespace starts a comment.
- Double quotes turn `\n` into a line break and may span lines.
- Single quotes keep the text exactly as written.

If a line is invalid, the command refuses to run and names the file. With `DEBUG=1`, startup lists
the names that the file set. A name missing from that list was already set by the environment.

`ohne dev` reloads the file on every change and restarts both servers. `PORT` is the exception: it
is read once, when `dev` starts, so to change it, restart `dev`.

## Flags

Every built-in is also a flag on the [`ohne` CLI](./cli.md#every-command), named in kebab-case. A
boolean variable becomes a switch, and the rest take a value:

```sh
npx ohne dev --port 4000
npx ohne sync --force-sync
npx ohne dev --no-color
```

- A switch turns off with a `no-` prefix: `--no-force-sync` turns `FORCE_SYNC` off for the run.
- `--no-color` does not turn a switch off. It is the flag for `NO_COLOR`.
- A flag wins over its environment variable.
- A value flag runs through the same parser, so `--port 99999` fails exactly like `PORT=99999`.

## Your own variables

Register a variable once, from a [boot file](./boot.md#when-they-run), and you read it with the same
typed `get` as the built-ins. Two steps: augment `Env` so TypeScript knows the name and type, then
`define` the runtime spec:

```ts
// boot/env.ts
import { boolEnv, useEnv } from 'ohnejs';
import { parseInteger } from 'ohnejs/utils';

declare module 'ohnejs' {
  interface Env {
    STRIPE_KEY: string | undefined;
    BILLING_DRY_RUN: boolean;
    POOL_SIZE: number;
  }
}

useEnv().define('STRIPE_KEY', { default: undefined });
useEnv().define('BILLING_DRY_RUN', { default: false, parse: boolEnv });
useEnv().define('POOL_SIZE', { default: 4, parse: (raw) => parseInteger(raw) });
```

```ts
useEnv().get('POOL_SIZE');  // number - 4, or the parsed POOL_SIZE
useEnv().get('STRIPE_KEY'); // string | undefined
```

- `default` - what `get` returns when the variable is unset.
- `parse` - turns the raw string into the typed value. Omit it for a plain string. Throw to reject
  an invalid value. The variable's name arrives as the second argument, so the error can name it.
  `boolEnv` is the boolean parser the built-ins use.

Reading a name that was never defined throws, so define it before the first `get`. Boot files run
before anything serves, which makes them the right place. A [layer](./layers.md) registers its
variables the same way, and its [boot files run before the app's](./boot.md#ordering).

## Overriding in code

`set` places an in-memory override that wins over the process environment, and `unset` clears it.
`set` never touches `process.env`, so nothing leaks between tests:

```ts
useEnv().set('SILENT', true);
useEnv().get('SILENT'); // true, whatever the process says
useEnv().unset('SILENT');
```
