# Messages

Messages are your app's translatable UI strings. You write them in JSON catalogs, one file per
language. Codegen types every key, and `useT` translates one in the language of the current request.
The framework's own strings, like
[validation failures and HTTP statuses](../api/errors.md#translated-messages), live in the same
catalogs, so everything a client sees can be in the user's language.

Catalogs translate what the app says, not what records store. Records translate through
[`translatable` fields](../database/translations.md#marking-fields). Adding `fr.json` gives you
French error messages but no French record values, and a new
[content locale](../project/config.md#content-locales) adds no UI language.

A catalog is a file under `messages/`, named after its language, and a handler translates with
`useT`:

`api/inbox.get.ts`

```ts files
import { defineHandler, useT } from 'ohnejs';

export default defineHandler(() => {
  const t = useT();
  return { status: t('inbox.unread', { count: 3 }) };
});
```

`messages/en.json`

```json files
{
  "inbox": {
    "empty": "No new notifications",
    "unread": "You have {count, plural, one {# unread message} other {# unread messages}}"
  }
}
```

`messages/de.json`

```json files
{
  "inbox": {
    "empty": "Keine neuen Benachrichtigungen",
    "unread": "Du hast {count, plural, one {# ungelesene Nachricht} other {# ungelesene Nachrichten}}"
  }
}
```

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
    "ohnejs": "0.0.2"
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

A request with `Accept-Language: de` gets "Du hast 3 ungelesene Nachrichten", and one without gets
the English text.

## Catalogs

One file per language, under each layer's [`dirs.messages`](../project/config.md#directories)
directory (default `messages/`), named by its BCP-47 tag: `en.json`, `de.json`, `de-AT.json`. The
file name without its extension is the language, so `de-at.json` and `de-AT.json` both mean `de-AT`.

Keys flatten to dot notation. Nesting inside a file supplies the segments, and a subdirectory
prefixes its keys. `messages/en.json` holding this:

```json
{ "inbox": { "empty": "No new notifications" } }
```

and `messages/inbox/en.json` holding this both contribute `inbox.empty`:

```json
{ "empty": "No new notifications" }
```

The first segment is the key's group, the unit the [catalog endpoint](#the-catalog-endpoint)
serves.

- Key segments are camelCase, acronyms fully uppercase: `invalidJSON`, never `invalidJson`.
- A `_`-prefixed file or directory is skipped, so a draft catalog can sit beside the live ones.
- Two files in one layer defining the same key for the same language is an error. Within a layer,
  every key is defined in one place.

## Templates

Every value is an ICU MessageFormat template: plain text, `{name}` placeholders, plurals, dates.
[ICU MessageFormat](./icu.md) teaches the whole syntax.

Put backticks around an interpolated value:

```json
"Invalid language `{language}`"
```

The backticks stay in the string, so a client can highlight the dynamic part, separate from the
static text. The framework's shipped catalogs all follow this convention.

A key's parameters must be the same in every language that defines it. If `en` writes `{count}` and
`de` spells it `{total}`, codegen fails, naming the key, both languages, and both files. A
translation always takes the same parameters the code passes. How it uses them may differ: `en`
can pluralize `{count}` while `ja` writes it plain.

## Typed keys

`useT` autocompletes keys, a typo is a compile error, and a parameterized key requires exactly its
parameters.

Codegen makes that work. It reads the merged catalogs and generates these types:

- `KnownMessages` maps each key to the parameter object its template expects.
- `KnownLanguages` has one entry per catalog language.

It runs at every [`ohne dev`](../project/cli.md#ohne-dev) and
[`ohne serve api`](../project/cli.md#ohne-serve) boot, and on demand with
[`ohne prepare`](../project/cli.md#ohne-prepare).

## Translating with useT

`useT()` returns a translator bound to the request's language:

```ts
const t = useT();

t('inbox.empty');                // -> 'No new notifications'
t('inbox.unread', { count: 3 }); // -> 'You have 3 unread messages'
```

The language is the first of these that applies:

1. [`context.locale`](../api/request.md#the-event), when a
   [middleware](../api/middleware.md#global-middleware) set it from a cookie, a route segment, or a
   user setting. Nothing is negotiated, so no `Vary` is added.
2. The best [`Accept-Language`](../api/request.md#content-negotiation) match among your catalog
   languages. `Accept-Language` is appended to the response `Vary`.
3. `messages.defaultLanguage`, `'en'` unless [config](../project/config.md#messages) says otherwise.
   It is typed to `KnownLanguages`, so it must be a language you actually have.

When the chosen language does not have a key, a less specific language fills it:

- `de-AT` falls back to `de`, then to the default language.
- A message filled by fallback is formatted with the rules of the language it was found in, so its
  plurals and numbers match its text.
- A key that no language defines renders as the key itself. It never throws, and it is never blank.

Outside a request, such as in a [boot file](../project/boot.md) or a script, `useT` uses the default
language.

## Layers

Catalogs merge across [layers](../project/layers.md#what-overrides-what), per key and language. A
closer layer overrides exactly the keys it redefines and leaves the rest in place. Your app is the
closest layer, so it overrides all others. `ohnejs/base` is at the bottom and ships the framework's
strings in English, German, and Bosnian. To replace one shipped string, you only need a tiny
`messages/en.json`:

```json
{
  "validation": {
    "required": "Don't leave this empty"
  }
}
```

To drop keys instead, list globs that match the dot-separated key in
[`disable.messages`](../project/config.md#disabling): `'dashboard.**'` drops a whole group.

## Validation messages

A [field validator](../database/writing.md#sanitizers-and-validators) rejects a value by returning
a `Message`:

- a message key,
- a `{ key, params }` object, when the message carries values,
- or a plain string.

With a catalog entry `"handleTooLong": "Keep it under {max} characters"` in a `profile` group:

```ts
field('text', {
  validators: [
    (value) =>
      value.length > 30 ? { key: 'profile.handleTooLong', params: { max: 30 } } : undefined,
  ],
});
```

The object is typed against `KnownMessages`, so the key must exist and the parameters must match
its template.

Inside a handler you rarely translate these yourself: a thrown validation failure becomes a
[`422`](../api/errors.md#write-failures) whose body carries each message already translated into the
request's language. When you handle the failure yourself, the result's
[`errors` map](../database/writing.md#the-result) holds the raw messages, and `useT` turns a key
into display text.

## The catalog endpoint

The API also serves the merged catalogs. `GET /messages/:group/:language` returns one group's keys
for a language:

```sh
curl http://localhost:9001/messages/inbox/de
```

```json
{
  "inbox.empty": { "template": "Keine neuen Benachrichtigungen", "language": "de" },
  "inbox.unread": {
    "template": "Du hast {count, plural, one {# ungelesene Nachricht} other {# ungelesene Nachrichten}}",
    "language": "de"
  }
}
```

- Each entry is the raw template plus the language it came from.
- The fallback chain runs server-side, key by key, so a `de-AT` request gets `de` entries where
  `de-AT` has no value of its own.
- The client formats each entry with the plural rules of the language it came from.
- A malformed language tag is a `400`, and a group with no keys a `404`.

The dashboard uses this endpoint: its
[browser-side `useT`](../dashboard/data.md#translations-in-the-browser) fetches each group on
demand, once per language, and renders the same keys your handlers use.
