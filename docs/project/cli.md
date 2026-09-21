# The CLI

Installing ohne installs one binary, `ohne`:

- [`ohne dev`](#ohne-dev) runs a project while you work.
- [`ohne prepare`](#ohne-prepare) generates its types.
- [`ohne serve`](#ohne-serve) runs one backend in production.
- [`ohne sync`](#ohne-sync) updates the database schema.

[`npm create ohne`](#npm-create-ohne) creates a project. Inside a project, `npx` runs that project's
own copy of the binary:

```sh
npx ohne --help
```

The scaffold also adds the everyday commands to `package.json`, so `npm run dev` and the other
scripts there run without `npx`.

## Every command

- `--help` prints usage for any command, and bare `ohne` prints the root help.
- `ohne --version` prints the installed version.
- `--cwd` sets the project root, defaulting to the current directory. A command refuses to run
  without an `ohne.config.ts` there.
- The [`.env` file](./env.md#the-env-file) at that root is read before anything else.
- Every built-in env var is also a [flag](./env.md#flags), so `PORT` is `--port`. The root help
  lists them under global options.

```sh
npx ohne serve api --port 8080 --host 0.0.0.0
```

## npm create ohne

`npm create ohne [dir]` scaffolds a new project: `ohne.config.ts`, `package.json`, `tsconfig.json`,
and a `.gitignore`. In a terminal it asks for the location (when you did not pass `dir`), the
project name, the package manager, and git, then installs the dependencies.

Flags cover every prompt. Put them after `--`, so npm hands them to the scaffold instead of
reading them itself:

```sh
npm create ohne my-app -- --yes --git
```

- `--yes` (`-y`) skips the prompts and the install, taking the defaults.
- `--name` sets the package name instead of the directory name.
- `--pm` sets the package manager, `npm` or `pnpm`. Without it, the default is npm when npm runs
  the scaffold, and pnpm otherwise.
- `--git` initializes a git repository.
- `--force` (`-f`) deletes everything in a non-empty directory, then scaffolds into it. Without it,
  the scaffold asks twice in a terminal before it deletes anything. Outside a terminal it refuses a
  non-empty directory.

Outside a terminal (CI, a script), `npm create ohne` behaves like `--yes`: no prompts, no
install, and the target defaults to the current directory. Run `npm install` before the first
`npm run dev`.

[Installation](../start/installation.md) takes a new project through its first run.

## ohne dev

One command runs everything while you work:

```sh
npx ohne dev
```

It starts the dashboard and the API, generates the types, and watches every layer in the
[stack](./layers.md#the-stack). A linked workspace layer reloads like your own code. Only installed
dependencies are skipped. On a change:

- **API source or a [message catalog](../i18n/messages.md#catalogs)** - regenerates the types it
  affects and restarts the API.
- **A dashboard file** - reloads the open browsers. Nothing restarts.
- **`ohne.config.ts`** - regenerates everything and restarts both servers.
- **[`.env`](./env.md#the-env-file)** - restarts both servers with the new values.

Each server is a child process, the same one `serve` runs in production. The API restarts as a fresh
process, so no old module is left after a reload.

A codegen error or a crashed API prints its error and waits. The next successful reload brings it
back.

Each server binds its configured port, `9000` for the dashboard and `9001` for the API by default.
When a port is already in use, `dev` warns and takes the next free one. `PORT` moves both: the
dashboard takes it, and the API takes the next free port.

## ohne prepare

`prepare` generates your project's types, then exits:

```sh
npx ohne prepare
```

Run it after a pull, or in CI before `tsc`. The rest of the time you do not need it: `dev` and
`serve api` generate the same types when they boot, and the scaffold adds `prepare` to
`package.json`, where npm runs it after an install.

The output lands in `.ohne/` by default: typed routes, middleware, message keys, database shapes,
and the resolved config, with the Node types and the browser types in separate folders. Your
`tsconfig.json` already includes them, and that is what makes queries and messages typed in the
editor.

You never import from `.ohne/` yourself. What it generates extends the types `ohnejs` exports, so
`import type { RoleName } from 'ohnejs'` gives you your own roles. Server code has no import
aliases, so use relative paths there. The dashboard's `app/` alias is covered in
[pages](../dashboard/pages.md#what-a-page-may-import).

Every run deletes what an earlier run generated, so no old file is left behind. It recognizes its
own files by a banner at the top, which also records the ohne version that wrote them. A file of
your own inside `.ohne/` is never touched.

## ohne serve

Production runs one process per backend:

```sh
npx ohne serve api
npx ohne serve dashboard
```

`serve api` runs the [boot files](./boot.md#when-they-run), regenerates the types,
[syncs the database schema](../database/sync.md#what-happens-at-boot), then listens. If the sync
fails, it never serves. With [`SKIP_CODEGEN`](./env.md#the-built-ins) set it skips the regeneration,
and warns when a different ohne version wrote the generated files.

`serve dashboard` serves the dashboard as a single-page app. For each request, it strips the types
from the requested module and sends it as JavaScript. It finds the API through `API_URL` or
[`dashboard.apiURL`](./config.md#the-dashboard), and otherwise derives the address from the API's
own config.

Both bind their configured host and port, or `HOST` and `PORT` when set.
[Deployment](../production/deployment.md) covers how the two processes fit together.

## ohne sync

`sync` updates the database schema to match your collections, then exits. It is the same sync a
server boot runs, without opening a port:

```sh
npx ohne sync
```

- [`--force`](../database/sync.md#force) allows the destructive changes the sync would otherwise
  refuse.
- [`--dry-run`](../database/sync.md#syncing-without-serving) runs the whole sync against the live
  database, then rolls it back. It exits non-zero where a real sync would refuse.

[The destructive guard](../database/sync.md#the-destructive-guard) covers what the sync refuses.
