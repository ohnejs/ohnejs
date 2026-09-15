# Environment variables

ohne reads its environment through a typed registry. Every variable is registered with a parser
and a default, so a read returns a typed value, never a raw string:

```ts
import { useEnv } from 'ohnejs';

useEnv().get('PORT');   // number | undefined
useEnv().get('SILENT'); // boolean
```

A malformed value fails loudly, naming the variable: `PORT=abc` refuses to boot with
`` `PORT` must be an integer between `0` and `65535` `` instead of serving on a surprise port.

## The built-ins

| Variable           | Default       | Effect                                                                                          |
| ------------------ | ------------- | ----------------------------------------------------------------------------------------------- |
| `NODE_ENV`         | `development` | The runtime environment. `production` and `test` match exactly; anything else is `development`. |
| `PORT`             | -             | Port for the HTTP servers, over `api.port` and `dashboard.port`.                                |
| `HOST`             | -             | Host for the HTTP servers, over `api.host` and `dashboard.host`.                                |
| `DATABASE`, `DB`   | -             | Main database URL, over `database.url`.                                                         |
| `FORCE_SYNC`       | `false`       | Authorizes a destructive [schema sync](../database/sync.md) for one boot.                       |
| `COOKIE_SECRET`    | -             | Signs cookies set with `setSignedCookie`; signed cookies throw until it is set.                 |
| `SILENT`           | `false`       | Silences all output, over `printer.silent`.                                                     |
| `DEBUG`            | `false`       | Enables ohne's debug output.                                                                    |
| `NO_COLOR`         | `false`       | Disables ANSI colors.                                                                           |
| `FORCE_COLOR`      | -             | Forces colors on or off, over terminal detection.                                               |
| `SKIP_CODEGEN`     | `false`       | Skips codegen at startup, for when a parent process already ran it.                             |
| `DASHBOARD_RELOAD` | `false`       | Serves the dashboard's live-reload stream. `ohne dev` turns it on for you.                      |
| `API_URL`          | -             | Base URL the dashboard's browser client calls, over `dashboard.apiURL`.                         |
| `DASHBOARD_URL`    | -             | Dashboard origin the API's [CORS](../api/middleware.md#cors) allows, over `dashboard.origin`.   |

Boolean variables accept `1`, `true`, `0`, and `false`, case-insensitive. Three go their own way:
`NO_COLOR` follows the no-color.org standard, where any non-empty value disables color; `DEBUG` is
a filter matched against the `ohne` namespace, so `DEBUG=1`, `DEBUG=*`, `DEBUG=ohne`, and
`DEBUG=ohne:*` all enable it; and `FORCE_COLOR` treats anything but `0` or `false` as on.

`DATABASE` and `DB` are aliases; setting both throws, since ohne cannot tell which you meant.

## Environment beats config

Several built-ins shadow a [config](./config.md) field. Config is what the project declares;
the environment is where it runs, so a set variable wins:

```sh
PORT=4000 pnpm exec ohne serve api
```

For any one read, the order is: CLI flag, then the process environment, then the project `.env`,
then the config field, then the built-in default. A set variable is a decision, not a fallback -
`SILENT=0` overrides `printer: { silent: true }` even though `0` is the "off" value.

## The `.env` file

A `.env` next to `ohne.config.ts` holds the variables you would rather not type into the shell,
secrets first among them. Every command reads it before anything else runs:

```sh
DATABASE=.data/dev.db
COOKIE_SECRET=a-long-random-value
```

The file fills gaps and never overrides. A variable the shell, your host, or CI already set keeps
its value, so `PORT=5000 pnpm dev` beats a `PORT` in the file, and a host that injects secrets
needs no file at all. Against config it counts as set, exactly as a shell variable would.

There is one file and no layering - no `.env.local`, no `.env.production`. In production, set the
real environment and ship no file. The code path is the same; the file is simply absent.

Lines are `KEY=value`. A `#` after whitespace starts a comment, double quotes interpret `\n` and
may span lines, and single quotes are literal. A malformed line refuses to run, naming the file.
With `DEBUG=1`, startup lists the names the file applied - a name missing from that list was
already set by the environment.

`ohne dev` reloads the file on every change and restarts both servers, so an edit takes effect
without a restart. `PORT` is the exception: it seeds the ports when `dev` starts. `ohne init`
already gitignores the file.

## Flags

Every built-in is also a flag on the `ohne` CLI - the kebab-case of its name. A boolean variable
becomes a switch, the rest take a value:

```sh
pnpm exec ohne dev --port 4000
pnpm exec ohne sync --force-sync
pnpm exec ohne dev --no-color
```

A switch negates with `no-`: `--no-force-sync` turns `FORCE_SYNC` off for the run. (`--no-color`
is `NO_COLOR`'s own flag, not a negation of `--color`.) The flag wins over the environment
variable, and a value flag runs through the same parser, so `--port 99999` fails exactly like
`PORT=99999`.

## Your own variables

Register a variable once, from a [boot file](./boot.md), and it reads with the same typed `get`
as the built-ins. Two steps: augment `Env` so TypeScript knows the name and type, then `define`
the runtime spec:

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

`default` is what `get` returns when the variable is unset. `parse` turns the raw string into the
typed value - identity when omitted, so a plain string variable needs no parser. Throw to reject
a malformed value; the variable's name arrives as the parser's second argument, so the error can
name it. `boolEnv` is the exact boolean parser the built-ins use, exported for yours.

Reading a name that was never defined throws, so define before the first `get`. Boot files run
before anything serves, which is what makes them the right place. A [layer](./layers.md) registers
its variables the same way; its boot files run before the app's.

## Overriding in code

`set` places an in-memory override that wins over the process environment; `unset` clears it.
`set` never touches `process.env`, so nothing leaks between tests:

```ts
useEnv().set('SILENT', true);
useEnv().get('SILENT'); // true, whatever the process says
useEnv().unset('SILENT');
```
