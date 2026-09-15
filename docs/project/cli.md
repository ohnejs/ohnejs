# The CLI

Installing ohne installs one binary, `ohne`. Its commands: `dev` runs a project while you work,
`prepare` generates its types, `serve` runs one backend in production, and `sync` reconciles the
database schema. A new project starts from `npm create ohne`, covered below. Run the binary with
`npx`, which picks up the project's own copy:

```sh
npx ohne --help
```

The scaffold wires the everyday ones as scripts, so `npm run dev` and `npm run serve:api` work out
of the box.

## Every command

`--help` prints usage for any command; `ohne --version` prints the installed version. Bare `ohne`
prints the root help.

Every command takes `--cwd`, the project root to operate on, defaulting to the
current directory. A command refuses to run without an `ohne.config.ts` at that root - the file
is what makes a directory an ohne project. It also reads a `.env` at that root before doing
anything else, filling in the variables the shell did not set - see
[the `.env` file](./env.md#the-env-file).

Every built-in env var is also a [flag](./env.md#flags) on every command - the kebab-case of its
name, so `PORT` is `--port` - and the root help lists them under global options.

```sh
npx ohne serve api --port 8080 --host 0.0.0.0
```

## npm create ohne

`npm create ohne [dir]` scaffolds a new project: `ohne.config.ts`, `package.json`, `tsconfig.json`,
and a `.gitignore`. On a TTY it prompts for the location, name, package manager, and git, then
installs the dependencies; `--yes` skips the prompts and the install, taking the defaults. A
non-empty target directory needs a double confirm to purge - or `--force` to purge without
asking. Flags go after `--`, as in `npm create ohne my-app -- --yes`, so npm passes them on. The
[installation guide](../start/installation.md) walks through the result.

## ohne dev

One command runs everything while you work:

```sh
npx ohne dev
```

`dev` is a supervisor. It starts the dashboard child, generates the types, then spawns the API
child - the very processes `serve` runs in production.

On every change it re-runs just the codegen the changed files affect, then drains the API child
and respawns it fresh - a new process every time, so no stale module survives a reload. A change
to `ohne.config.ts` regenerates everything, since config decides what everything else means. The
watch covers every layer in the stack, not just your app: a linked workspace layer reloads like
your own code, and only installed dependencies are skipped.

The dashboard child restarts only on a config change, since the layer stack it serves is decided
there; otherwise it reads its modules from disk per request, so a change under
a dashboard directory just tells the connected browsers to reload, over a live-reload stream the
dev run injects into the page.

Failures never tear the supervisor down. A codegen error or a crashed API child prints its error,
the supervisor waits for changes, and the next successful reload revives it.

`PORT` seeds the pair: the dashboard takes it and the API takes the next free port, so the whole
stack moves together. Without it, each side binds its configured port - `9000` and `9001` by
default - and a port already in use is skipped past with a warning.

A change to `.env` reloads it and restarts both children, so they run with the new values. `PORT`
is read once, when `dev` starts, so moving the ports takes a fresh `dev`.

## ohne prepare

`prepare` runs every codegen and exits:

```sh
npx ohne prepare
```

The output lands in the codegen dir, `.ohne/` by default: the typed routes, middleware, message
keys, database shapes, the resolved config, and a browser tsconfig, split into buckets so the
Node and browser type programs each include only theirs. Your `tsconfig.json` includes those
buckets - that is what makes queries and messages fully typed in the editor.

Files an earlier run left behind are pruned. Only files carrying the generated banner are ever
deleted, so a file of your own inside `.ohne/` is never touched. The banner also stamps the ohne
version that wrote the file.

The scaffold wires it as the npm `prepare` script, so a fresh install generates the types before
you open the editor. `dev` and `serve api` regenerate on boot anyway; `prepare` is for the times
in between - after a pull, or in CI before `tsc`.

## ohne serve

Production runs one process per backend:

```sh
npx ohne serve api
npx ohne serve dashboard
```

`serve api` boots the API: it runs the boot files, regenerates the types (skipped when
`SKIP_CODEGEN` is set, as under `dev`), syncs the database schema, then listens. The sync runs
before the port opens, so a failed sync never serves. With `SKIP_CODEGEN` set, it still reads the
version stamp on the generated files and warns when a different ohne wrote them.

`serve dashboard` serves the dashboard as a pure single-page app: a shell document plus the
modules it imports, type-stripped to JavaScript per request - no build step, nothing to bundle.
It needs to know where the API lives: `API_URL` (or `dashboard.apiURL` in config) tells it, and
without either it derives the address from the API's own config.

Both bind their configured host and port, overridden by `HOST` and `PORT` when set. How the two
processes fit a deployment is covered in [deployment](../production/deployment.md).

## ohne sync

`sync` reconciles the database schema with your collections and exits - the same sync a server
boot runs, without opening a port:

```sh
npx ohne sync
```

`--force` authorizes the destructive changes the sync would otherwise refuse; `--dry-run`
rehearses everything against the live database and rolls it back, exiting non-zero where a real
sync would refuse. [Schema sync](../database/sync.md) covers what the sync does and when to reach
for each flag.
