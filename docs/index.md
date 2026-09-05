# ohne

ohne is a zero-dependency TypeScript framework for the web. It gives you a database, an HTTP API,
internationalization, and a dashboard, with no build step and no runtime dependencies. The
framework ships `.ts` source, your app is `.ts` source, and Node 26 runs both directly. What you
write is what runs.

The name is German for "without". The constraint is the product: no bundler, no transpile, no
transitive dependency tree to audit. You reach for Node's own building blocks and the framework
fills the gaps.

## Start here

New to ohne? Read these two in order:

- [Getting started](./start/installation.md) - install, scaffold a project, and run it.
- [Your first app](./start/tutorial.md) - build a small blog end to end: a collection, two
  endpoints, and a dashboard page.

Everything below is reference-shaped: read the page for the part you are working on.

## The project

How a project is put together - the config file, the CLI, and the layer system that lets one
project extend another.

- [Configuration](./project/config.md) - `ohne.config.ts` and every setting it holds.
- [The CLI](./project/cli.md) - `dev`, `init`, `prepare`, `serve`, and `sync`.
- [Environment variables](./project/env.md) - the built-ins and how to define your own.
- [Boot files](./project/boot.md) - code that runs before the server opens.
- [Layers](./project/layers.md) - stack projects as packages and override what they ship.

## Database

Declare your data as collections of fields. ohne keeps the schema in step with your code and gives
you a typed query builder for reads and writes.

- [Collections and fields](./database/collections.md) - the field types and their options.
- [Conditional fields](./database/conditional-fields.md) - fields that activate on a condition.
- [Blocks](./database/blocks.md) - ordered lists of mixed, reusable shapes.
- [Translations](./database/translations.md) - one value per locale.
- [Reading records](./database/queries.md) - the fluent query builder: filter, sort, paginate,
  populate.
- [Writing records](./database/writing.md) - create, update, and delete.
- [Schema sync](./database/sync.md) - how your collections become tables, safely.
- [Migrations](./database/migrations.md) - intentional data changes the sync guard would refuse.
- [The database](./database/engine.md) - the SQLite engine, connections, and raw SQL.
- [Cluster locks](./database/with-lock.md) - run work exactly once across instances.

## Uploads

An optional layer for files: storage behind a pluggable backend, an `Uploads` collection, upload
and serve routes, media fields, and the dashboard's Media page.

- [Uploads](./uploads/uploads.md) - install the layer, configure storage, upload and serve files.
- [Media fields](./uploads/fields.md) - reference uploads from your collections.
- [Image variants](./uploads/images.md) - signed URLs an image service renders on demand.

## HTTP API

Define endpoints as files. Handlers read the request and return a value ohne serializes for you.

- [Routes](./api/routes.md) - the file convention and `defineHandler`.
- [Reading the request](./api/request.md) - params, search params, body, cookies, negotiation.
- [Shaping the response](./api/response.md) - status, headers, redirects, caching, files, events.
- [HTTP errors](./api/errors.md) - `HTTPError` and the wire shape a client receives.
- [Middleware](./api/middleware.md) - code that wraps every matching request.
- [Hooks](./api/hooks.md) - react to framework lifecycle events.
- [Querying over HTTP](./api/url-queries.md) - turn a URL query into a safe, filtered read.
- [The collections API](./api/collections.md) - REST endpoints a collection opts into.

## Authentication

Email and password accounts, sessions, and the helpers to gate a route. Shipped by the ohne layer,
so an app opts out by not stacking it.

- [Authentication](./auth/authentication.md) - the `Users` collection, the `/auth` endpoints, and
  `useUser`.
- [Roles and capabilities](./auth/roles.md) - code-defined roles, capability guards, and the
  collections API's default protection.

## Internationalization

Two independent systems: message catalogs for your UI strings, and content locales for your data
(covered in [translations](./database/translations.md)).

- [Messages](./i18n/messages.md) - catalogs, `useT`, and language negotiation.
- [ICU MessageFormat](./i18n/icu.md) - the template syntax your messages are written in.

## Dashboard

A browser UI for your app, served by ohne with no build step. Pages are `.ts` modules that ship to
the browser as type-stripped JavaScript.

- [Dashboard pages](./dashboard/pages.md) - the pages convention and how they are served.
- [Rendering](./dashboard/rendering.md) - `h`, `mount`, `each`, `when`, and the router.
- [Reactivity](./dashboard/reactivity.md) - `ref`, `computed`, and `effect`.
- [Data in the dashboard](./dashboard/data.md) - the typed `api()` fetch helper and translations.

## Production

- [Deployment](./production/deployment.md) - serving, persistence, and hardening for production.
