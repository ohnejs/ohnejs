# Installation

## Requirements

Node.js 26 or newer. Node runs your TypeScript directly by stripping the types, which is why there
is no build step. It also limits you to syntax Node can strip, so you cannot use `enum`.

## Creating a project

```sh
npm create ohne my-app
```

`npm create ohne` asks for the project name, the package manager, and whether to initialize a git
repository. To skip the prompts in CI or a script, pass [flags](../project/cli.md#npm-create-ohne).

## First run

```sh
cd my-app
npm run dev
```

[`ohne dev`](../project/cli.md#ohne-dev) starts the dashboard at `http://localhost:9000` and the
API at `http://localhost:9001`, then reloads as you save. Open the dashboard and create the first
user - that account gets the [`admin` role](../auth/roles.md#assigning-roles).

## The project files

`npm create ohne` writes four files:

`ohne.config.ts`

```ts files
import { defineConfig } from 'ohnejs';

export default defineConfig({
  layers: ['ohnejs/base'],
});
```

`package.json`

```json files
{
  "name": "my-app",
  "type": "module",
  "private": true,
  "scripts": {
    "dev": "ohne dev",
    "serve:api": "ohne serve api",
    "serve:dashboard": "ohne serve dashboard",
    "prepare": "ohne prepare",
    "typecheck": "tsc"
  },
  "dependencies": {
    "ohnejs": "0.0.1"
  },
  "devDependencies": {
    "@types/node": "26.0.0",
    "typescript": "7.0.2"
  },
  "engines": {
    "node": ">=26.0.0"
  }
}
```

`tsconfig.json`

```json files
{
  "extends": "ohnejs/tsconfig.node.json",
  "include": ["**/*.ts", ".ohne/shared/**/*.ts", ".ohne/node/**/*.ts"],
  "exclude": ["dashboard"]
}
```

`.gitignore`

```gitignore files
# Dependencies
node_modules/

# Generated
.ohne/

# Data
.data/

# Environment / secrets
.env

# OS
.DS_Store
```

- `ohne.config.ts` - the project's [config](../project/config.md), and what marks the directory as
  an ohne project. `layers: ['ohnejs/base']` puts the framework's own
  [layer](../project/layers.md#what-the-base-layer-ships) under your app.
- `package.json` - scripts for `dev` and the rest of the [CLI](../project/cli.md). `ohnejs` is the
  only dependency; TypeScript is there to type-check, never to compile.
- `tsconfig.json` - type-checks your Node code against the config ohne ships. `dashboard/` is
  browser code and gets a [config of its own](../dashboard/pages.md#type-checking) when you add one.
- `.gitignore` - keeps dependencies, generated files, the
  [local database](../database/engine.md#where-the-database-lives), and
  [`.env`](../project/env.md#the-env-file) out of git.

`ohne dev` also writes `.ohne/`, the [types it generates](../project/cli.md#ohne-prepare) from your
project. ohne rebuilds it when needed, so you never edit it.

From here, the [tutorial](./tutorial.md) builds your first app: a collection, an endpoint, a
query, and a dashboard page.
