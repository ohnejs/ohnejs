# Messages

Messages are your app's translatable UI strings. You write them in JSON catalogs, one file per
language; codegen types every key, and `useT` translates one in the language of the current
request. The framework's own strings - validation failures, HTTP statuses - live in the same
catalogs, so everything a client sees can speak the user's language.

A catalog is a file under `messages/`, named after its language. `messages/en.json`:

```json
{
  "inbox": {
    "empty": "No new notifications",
    "unread": "You have {count, plural, one {# unread message} other {# unread messages}}"
  }
}
```

And `messages/de.json`:

```json
{
  "inbox": {
    "empty": "Keine neuen Benachrichtigungen",
    "unread": "Du hast {count, plural, one {# ungelesene Nachricht} other {# ungelesene Nachrichten}}"
  }
}
```

A handler translates with `useT`:

```ts
// api/inbox.get.ts
import { defineHandler, useT } from 'ohne';

export default defineHandler(() => {
  const t = useT();
  return { status: t('inbox.unread', { count: 3 }) };
});
```

A request with `Accept-Language: de` answers "Du hast 3 ungelesene Nachrichten"; one without gets
the English.

## Catalogs

One file per language, under each layer's `dirs.messages` directory (default `messages/`), named
by its BCP-47 tag: `en.json`, `de.json`, `de-AT.json`. The stem is the language - `de-at.json` and
`de-AT.json` both mean `de-AT`.

Keys flatten to dot notation. Nesting inside the file supplies the segments, and a subdirectory
prefixes its keys, so `messages/en.json` holding `{ "inbox": { "empty": ... } }` and
`messages/inbox/en.json` holding `{ "empty": ... }` both contribute `inbox.empty`. The first
segment is the key's group - the unit the catalog endpoint serves (below). Key segments are
camelCase, acronyms fully uppercase: `invalidJSON`, never `invalidJson`.

A `_`-prefixed file or directory is skipped, so a draft catalog can sit beside the live ones. Two
files in one layer defining the same key for the same language is an error - within a layer,
every key has one home.

## Templates

Every value is an ICU MessageFormat template: plain text, `{name}` placeholders, plurals, dates.
[ICU MessageFormat](./icu.md) teaches the whole syntax.

Backtick an interpolated value:

```json
"Invalid language `{language}`"
```

The backticks travel with the string, so a client can render the dynamic part as a highlight,
distinct from the static prose. The framework's shipped catalogs all follow this convention.

A key's parameters must agree across every language that defines it. If `en` writes `{count}`
and `de` spells it `{total}`, codegen fails, naming the key, both languages, and both files - a
translation can never drift from the shape the code passes.

## Typed keys

Codegen reads the merged catalogs and emits `KnownMessages` - one entry per key, mapping it to
the exact parameter object its template expects - and `KnownLanguages`, one entry per catalog
language. It runs at every `ohne dev` and `ohne serve api` boot, and on demand with
[`ohne prepare`](../project/cli.md#ohne-prepare).

From then on messages are part of the type surface: `useT` autocompletes keys, a typo is a
compile error, and a parameterized key demands its parameters, exactly typed.

## Translating with useT

`useT()` returns a translator bound to the request's language:

```ts
const t = useT();

t('inbox.empty');                // -> 'No new notifications'
t('inbox.unread', { count: 3 }); // -> 'You have 3 unread messages'
```

The language is `context.locale` when a [middleware](../api/middleware.md) set it - from a
cookie, a route segment, a user setting. Otherwise it is the best `Accept-Language` match among
your catalog languages, with `Accept-Language` appended to the response `Vary`; a forced
`locale` skips negotiation, so no `Vary` is added. A request offering neither resolves to
`messages.defaultLanguage` - `'en'` unless [config](../project/config.md#messages) says
otherwise, and typed to `KnownLanguages` so it must be a language you actually have.

A key the chosen language misses is filled from a less specific one: `de-AT` falls back to `de`,
then to the default language. A fallback-filled message formats with the rules of the language it
was found in, so its plurals and numbers match its text. A key no language defines renders as the
key itself - never a throw, never a blank.

Outside a request - a [boot file](../project/boot.md), a script - `useT` resolves the default
language.

## Layers

Catalogs merge across [layers](../project/layers.md), per key and language: a closer layer
overrides exactly the keys it redefines and leaves the rest in place, and your app, the closest
layer, overrides all. The framework's own layer is the base, shipping its `api.*`, `query.*`, and
`validation.*` strings in English, German, and Bosnian - so replacing one shipped string is a
tiny catalog:

```json
{
  "validation": {
    "required": "Don't leave this empty"
  }
}
```

To drop keys instead, `disable.messages` in config takes globs over the dot-separated key
(`'dashboard.**'` drops a whole group); a dropped key vanishes from the catalogs, the endpoint,
and the generated types.

## Validation messages

A field validator rejects a value by returning a `Message`: a message key, a `{ key, params }`
object when the message carries values, or a plain string. With a catalog entry
`"handleTooLong": "Keep it under {max} characters"` in a `profile` group:

```ts
field('text', {
  validators: [
    (value) =>
      value.length > 30 ? { key: 'profile.handleTooLong', params: { max: 30 } } : undefined,
  ],
});
```

The object is typed against `KnownMessages`, so the key must exist and the parameters must match
its template. Inside a handler you rarely resolve these yourself: a thrown validation failure
becomes a `422` whose body carries each message already resolved in the request's language - see
[writing records](../database/writing.md). When you shape the failure yourself, the result's
`errors` map holds the raw messages, and `useT` turns a key into display text.

## The catalog endpoint

The API serves the merged catalogs back out. `GET /messages/:group/:language` returns one
group's keys for a language:

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

Each entry is the raw template plus the language it came from - the fallback chain runs
server-side, key by key, so a `de-AT` request gets `de` entries where `de-AT` has no own value,
and the client formats each with its origin language's plural rules. A malformed language tag is
a `400`, a group with no keys a `404`.

This endpoint is what feeds the dashboard: its browser-side `useT` fetches each group on demand,
once per language, and renders the same keys your handlers use. See
[dashboard data](../dashboard/data.md).

## Not content locales

Message languages and content locales are independent systems. Catalogs translate the UI - what
the app says. Content locales translate what records store, through `translatable` fields - what
the app manages. Adding `fr.json` gives you French error messages; it does not make records hold
French values, and a new content locale adds no UI language. See
[translations](../database/translations.md).
