# Getting started

ohne is a zero-dependency TypeScript framework for the web. There is no build step: the framework
ships `.ts` source, your app is `.ts` source, and Node runs both directly. What you write is what
runs.

## Requirements

Node.js 26 or newer. Node 26 executes TypeScript natively by stripping the types, which is what
makes the no-build setup work - nothing transpiles, nothing bundles. The scaffold pins `engines`
to it, and TypeScript itself is only a dev dependency, there for type checking.

## Creating a project

```sh
pnpm dlx ohne init my-app
```

In a terminal, `init` walks you through the setup: where the project goes (when you did not pass
it), the project name (defaulting to the directory name), the package manager (npm or pnpm), and
whether to initialize a git repository. It then writes the files and installs the dependencies.

Flags cover every prompt:

- `--yes` (`-y`) skips the prompts and the install, taking the defaults.
- `--name` sets the package name instead of the directory name.
- `--git` initializes a git repository.
- `--force` (`-f`) overwrites a non-empty directory. Without it, a non-empty target asks twice
  in a terminal and refuses outside one.

Outside a terminal - CI, a script - `init` behaves like `--yes`: no prompts, no install, and the
target defaults to the current directory.

## The scaffold

`init` writes four files:

```
my-app/
├── .gitignore
├── ohne.config.ts
├── package.json
└── tsconfig.json
```

`ohne.config.ts` marks the directory as an ohne project and declares its layers:

```ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs'],
});
```

`layers: ['ohnejs']` makes the framework's own layer the base of your app - its config defaults,
messages, and dashboard come from there. [Config](../project/config.md) covers every option;
[layers](../project/layers.md) covers what a layer is.

`package.json` wires the CLI into scripts:

```json
{
  "scripts": {
    "dev": "ohne dev",
    "serve:api": "ohne serve api",
    "serve:dashboard": "ohne serve dashboard",
    "prepare": "ohne prepare",
    "typecheck": "tsc"
  }
}
```

`dev` is the development server; the two `serve` scripts each run one production backend;
`prepare` generates the project types (below). `typecheck` is plain `tsc` - the shipped config
sets `noEmit`, so TypeScript checks and never compiles. The only dependency is `ohnejs`; TypeScript
and the Node types are dev dependencies.

`tsconfig.json` extends the config ohne ships:

```json
{
  "extends": "ohnejs/tsconfig.node.json",
  "include": ["**/*.ts", ".ohne/shared/**/*.ts", ".ohne/node/**/*.ts"],
  "exclude": ["dashboard"]
}
```

The base config pins what the no-build setup needs, `erasableSyntaxOnly` among it, so you can only
write syntax Node can strip. The two `.ohne/` entries pull the generated types into the program:
`shared` holds plain types, `node` holds the augmentations that type your routes, collections, and
messages. `dashboard/` is excluded because dashboard code is browser code, checked by its own
TypeScript program when you add one.

`.gitignore` keeps the generated and the local out of the repository: `.ohne/` is regenerated on
demand, `.data/` holds the SQLite database (`.data/ohne.db` by default), and `.env` holds secrets,
which every command reads at start - see [the `.env` file](../project/env.md#the-env-file).

## First run

```sh
cd my-app
pnpm dev
```

If you skipped the install with `--yes`, run `pnpm install` first.

`ohne dev` starts the dashboard at `http://localhost:9000`, generates the project types, and boots
the API at `http://localhost:9001`. Then it watches. Change a source file and the API reloads;
change a dashboard file and the open browser reloads instead - the API keeps running.

The [CLI page](../project/cli.md) covers every command in depth.

## Generated types

The `.ohne/` directory holds what codegen derives from your project: the types for your routes,
middleware, message keys, and collection shapes, plus the resolved config. You never write into
it - `ohne prepare` runs every codegen once, and `ohne dev` regenerates whatever a change affects
while it runs.

`prepare` is wired as the npm `prepare` script, so every install runs it - a fresh clone
type-checks right after `pnpm install`.

The directory is disposable. Every run writes the full set and prunes what an earlier run left
behind, so you can delete `.ohne/` at any time and the next `prepare` or `dev` rebuilds it. That
is why it is gitignored.

From here, the [tutorial](./tutorial.md) builds your first app: a collection, an endpoint, a
query, and a dashboard page.
