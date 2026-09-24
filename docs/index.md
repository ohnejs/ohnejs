# ohne

ohne is a **zero-dependency** TypeScript framework for the web. It gives you a database, an HTTP
API, internationalization, and a dashboard, with **no build step**. The framework ships `.ts`
source, your app is `.ts` source, and Node 26 runs both directly. What you write is what runs.

## Start here

New to ohne? Read these in order:

- [Installation](./start/installation.md) - install, scaffold a project, and run it.
- [Directory structure](./start/directory-structure.md) - where each kind of file lives, and what
  ohne does with it.
- [Your first app](./start/tutorial.md) - build a small blog end to end: a collection, two
  endpoints, and a dashboard page.

## Project

How a project is put together - the config file, the CLI, and the layer system that lets one
project extend another.

- [Configuration](./project/config.md) - `ohne.config.ts` and the core settings it holds.
- [The CLI](./project/cli.md) - `npm create ohne` and every `ohne` command.
- [Environment variables](./project/env.md) - the built-ins and how to define your own.
- [Boot files](./project/boot.md) - code that runs before the server opens.
- [Hooks](./project/hooks.md) - run code at fixed points in the framework, or change what it
  produces.
- [Layers](./project/layers.md) - stack projects as packages and override what they ship.

## Database

Declare your data as collections of fields. ohne keeps the schema in sync with your code and gives
you a typed query builder for reads and writes.

- [Collections and fields](./database/collections.md) - your data model, and the built-in field
  types it is made of.
- [Field types](./database/field-types.md) - every field type ohne ships, with all of its options.
- [Custom field types](./database/custom-field-types.md) - define a field type once, use it in any
  collection.
- [Conditional fields](./database/conditional-fields.md) - fields that are active only when a
  condition is true.
- [Blocks](./database/blocks.md) - ordered lists of mixed, reusable shapes.
- [Translations](./database/translations.md) - one value per locale.
- [Reading records](./database/reading.md) - the fluent query builder: filter, sort, paginate,
  populate.
- [Writing records](./database/writing.md) - create, update, and delete.
- [Schema sync](./database/sync.md) - how your collections become tables, safely.
- [Migrations](./database/migrations.md) - intentional data changes the sync guard would refuse.
- [The database engine](./database/engine.md) - the SQLite engine, connections, and raw SQL.
- [Cluster locks](./database/locks.md) - run work exactly once across instances.

## HTTP API

Define endpoints as files. Handlers read the request and return a value ohne serializes for you.

- [Routes](./api/routes.md) - the file convention and `defineHandler`.
- [Reading the request](./api/request.md) - params, search params, body, cookies, negotiation.
- [Shaping the response](./api/response.md) - status, headers, redirects, caching, files, events.
- [HTTP errors](./api/errors.md) - `HTTPError` and the JSON body a client receives.
- [Middleware](./api/middleware.md) - code that runs before the handler on every matching
  request.
- [Querying over HTTP](./api/url-queries.md) - turn a URL query into a safe, filtered read.
- [The collections API](./api/collections.md) - REST endpoints a collection opts into.

## Auth

Email and password accounts, sessions, roles, and the helpers to protect a route. Shipped by the
`ohnejs/base` layer, so an app opts out by not stacking it.

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

- [Dashboard pages](./dashboard/pages.md) - the pages convention, navigation, the sidebar, and how
  pages are served.
- [Rendering](./dashboard/rendering.md) - `h`, `mount`, `each`, and `when`.
- [Reactivity](./dashboard/reactivity.md) - `ref`, `computed`, and `effect`.
- [Data in the dashboard](./dashboard/data.md) - the typed `api()` fetch helper and translations.
- [Field layouts](./dashboard/field-layouts.md) - rows, cards, tabs, and rules for every form the
  dashboard renders.
- [Account settings](./dashboard/account.md) - each user's language, time zone, date and time
  formats, and smart clipboard.

## Uploads

An optional layer for files: storage with a backend you can replace, an `Uploads` collection, upload
and serve routes, media fields, and the dashboard's Media page.

- [Uploads](./uploads/uploads.md) - install the layer, configure storage, upload and serve files.
- [Storage](./uploads/storage.md) - the filesystem, S3, or a backend of your own.
- [Media fields](./uploads/fields.md) - reference uploads from your collections.
- [Image variants](./uploads/image-variants.md) - signed URLs an image service renders on demand.
- [Private files](./uploads/private-files.md) - files that open only through an expiring link or
  for a signed-in reader.
- [The image service](./uploads/image-service.md) - the protocol a service follows to render
  variants.

## Production

Your app deploys as the source you wrote, with no build step.

- [Deployment](./production/deployment.md) - serving, persistence, and hardening for production.
