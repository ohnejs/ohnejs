# Installation

## Requirements

Node.js 26 or newer. Node runs your TypeScript directly by stripping the types, which is why there
is no build step. It also limits you to syntax Node can strip, so you cannot use `enum`.

## Creating a project

```sh
npm create ohne my-app
```

`npm create ohne` asks for the project name, whether to add a website, the package manager, and
whether to initialize a git repository. To skip the prompts in CI or a script, pass
[flags](../project/cli.md#npm-create-ohne).

A Nuxt or Next website makes the project a [monorepo](../project/monorepo.md), with your app and
the website side by side. This page follows the app alone.

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
  auth: { cookieName: 'my-app-session' },
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
    "test": "ohne prepare && node --test --import ohnejs/register \"tests/**/*.test.ts\"",
    "typecheck": "tsc"
  },
  "dependencies": {
    "ohnejs": "0.5.1"
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
  [layer](../project/layers.md#what-the-base-layer-ships) under your app. The session cookie is
  named after the project, since two apps on one machine would otherwise sign each other out.
- `package.json` - scripts for `dev` and the rest of the [CLI](../project/cli.md). `ohnejs` is the
  only dependency; TypeScript is there to type-check, never to compile.
- `tsconfig.json` - type-checks your Node code against the config ohne ships. `dashboard/` is
  browser code and gets a [config of its own](../dashboard/pages.md#type-checking) when you add one.
- `.gitignore` - keeps dependencies, generated files, the
  [local database](../database/engine.md#where-the-database-lives), and
  [`.env`](../project/env.md#the-env-file) out of git.

`ohne dev` also writes `.ohne/`, the [types it generates](../project/cli.md#ohne-prepare) from your
project. ohne rebuilds it when needed, so you never edit it.

Next, [Directory structure](./directory-structure.md) shows where the rest of your app will live.
Then the [tutorial](./tutorial.md) builds your first app: a collection, two endpoints, and a
dashboard page.
