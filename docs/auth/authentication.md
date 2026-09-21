# Authentication

The `ohnejs/base` layer ships email and password authentication: a `Users` collection, session
cookies, the sign-in endpoints, and helpers to read the signed-in user.
[Stack it](../project/layers.md#consuming-a-layer) and it is there.
[Leave it out](../project/layers.md#going-without-it) and none of it exists, so you are free to
[build your own](#rolling-your-own).

No signup endpoint ships. Account creation differs too much between apps to ship one way: some apps
are invite-only, some verify the email, and some ask users to accept terms.
[Creating accounts](#creating-accounts) shows how to write yours.

## The endpoints

These routes cover the sign-in flow, the account, and first-user setup. Each uses JSON.

```bash
# Sign in. Returns the user and sets the session cookie.
POST  /auth/login   { "email": "ada@example.com", "password": "correct horse", "remember": true }
# -> 200 the user

# Sign out. Deletes the session and clears the cookie.
POST  /auth/logout
# -> 200 { "ok": true }

# Sign out every other session of the account, keeping this one.
POST  /auth/logout/others
# -> 200 { "ok": true }, or 401 when signed out

# The signed-in user, read from the session cookie.
GET   /auth/me
# -> 200 the user, or 401 when signed out

# Update the signed-in user's own settings. A partial body; unknown keys are a 422.
PATCH /auth/me      { "timezone": "Europe/Berlin", "dateFormat": "DD.MM.YYYY" }
# -> 200 the user, 422 with per-field messages, or 401 when signed out

# Whether first-user setup is still pending.
GET   /auth/install
# -> 200 { "required": true }, or { "required": false } once a user exists

# Create the first user with the admin role and sign it in.
POST  /auth/install { "email": "ada@example.com", "password": "correct horse" }
# -> 200 the user, 422 with per-field messages, or 403 once a user exists
```

The user has the same shape everywhere: `UUID`, `email`, the
[role names](./roles.md#assigning-roles), and the
[account settings](../dashboard/account.md#the-settings). Those settings are `dashboardLanguage`,
`contentLanguage`, `timezone`, `dateFormat`, `timeFormat`, and `smartClipboard`. A response never
carries the password hash.

```json
{
  "UUID": "…",
  "email": "ada@example.com",
  "roles": [],
  "dashboardLanguage": null,
  "contentLanguage": null,
  "timezone": "Europe/Berlin",
  "dateFormat": "DD.MM.YYYY",
  "timeFormat": "LTS",
  "smartClipboard": false
}
```

The email is stored trimmed and lowercased, so `Ada@Example.com` and `ada@example.com` are the same
account.

- **`POST /auth/login`** - matches the email in either form. A wrong password and an unknown email
  both answer `401` with the same message, so a caller cannot find out which emails exist.
  `remember` asks for a lasting session. Omit it and the sign-in counts as not remembered, so a
  scripted client that never sends it gets the shorter [session](#sessions) lifetime.
- **`PATCH /auth/me`** - accepts the fields the
  [`auth:account-layout` hook](../dashboard/account.md#extending-the-page) places, by default the
  name, the account settings, and `password`. The write runs through the field pipeline, so a bad
  time zone or a blank format answers `422` exactly as a collection write would. A new password is
  hashed before it is stored, and changing it does not require the current password. `email` and
  `roles` are not accepted: an administrator changes those through the `Users` collection.
- **`/auth/install`** - is what the dashboard's install page calls. While `Users` is empty, the
  dashboard opens that page instead of the login, and it creates the first account with the `admin`
  role and signs it in.

## Creating accounts

To write your own signup, use the `Users` collection and the same helpers the sign-in flow uses:

```ts
// api/signup.post.ts
import { defineHandler, query, readJSONBody } from 'ohnejs';
import { createSession, toUser } from 'ohnejs/auth';

export default defineHandler(async () => {
  const { email, password } = await readJSONBody<{ email: string; password: string }>();
  // enforce whatever your app wants here: a length rule, an invite, a captcha...

  const record = await query('Users').createOrThrow({ email, password });

  await createSession(record.UUID);
  return toUser(record);
});
```

You pass the password as plain text. The `password` field hashes it with scrypt just before it is
stored, so the plaintext is never saved anywhere and there is no hashing step to remember. The field
is [write-only](../database/collections.md#write-only-and-locked-fields) (`readable: false`), so no
read returns the hash, not even `record` here.

- [`createOrThrow`](../database/writing.md#the-result) runs the collection's own email validation
  and its unique constraint, so a bad or duplicate email answers `422` with per-field messages.
- `createSession` writes the session cookie, exactly as `login` does.
- `toUser` returns the same `User` shape that `login` returns.

A new account holds no [roles](./roles.md#assigning-roles) unless you pass some, like
`roles: ['editor']`. The first administrator comes from the [install routes](#the-endpoints).

## Adding fields to `Users`

Your own `collections/Users.ts` [replaces](../project/layers.md#what-overrides-what) the ohne
layer's `Users` collection completely. Spread `usersDefinition` from `ohnejs/auth` to keep the
fields that sign-in and the account page read, then add yours:

```ts
// collections/Users.ts
import { defineCollection, field } from 'ohnejs';
import { usersDefinition } from 'ohnejs/auth';

export default defineCollection({
  ...usersDefinition,
  fields: { ...usersDefinition.fields, phone: field('text', { nullable: true }) },
});
```

Make an added field [`nullable: true`](../database/collections.md#column-fields) or give it a
`default`, because the install page creates the first admin from only an email and a password.
[`useUser`](#reading-the-current-user) returns the `User` shape without your fields, so read them
with `query('Users')`.

## Reading the current user

Inside your own [route handler](../api/routes.md), get the current user with `useUser`. It returns
the user, typed as `User` from `ohnejs/auth`, or `null` when the request has no live session.
Outside a request, in a boot file or a script, there is no session to read, so it resolves to `null`
there too.

```ts
// api/profile.get.ts
import { defineHandler } from 'ohnejs';
import { useUser } from 'ohnejs/auth';

export default defineHandler(async () => {
  const user = await useUser();
  return user ? { email: user.email } : { guest: true };
});
```

When a route requires a user, `requireUser` returns it or throws `401`:

```ts
// api/account.get.ts
import { defineHandler } from 'ohnejs';
import { requireUser } from 'ohnejs/auth';

export default defineHandler(async () => {
  const user = await requireUser();
  return { UUID: user.UUID, email: user.email };
});
```

Both read the session once per request and return the public user shape, never the password hash, so
their result is safe to return as-is. To ask
[what the user may do](./roles.md#guarding-your-own-routes), not just who they are, check their
capabilities.

### Protecting routes with middleware

Instead of calling `requireUser` in every protected handler, add the `require-auth`
[middleware](../api/middleware.md#route-middleware) to the route. It answers `401` when there is no
session, so the handler runs only for a signed-in request. It also sets
[`event.context.user`](../api/request.md#the-event) for the handler to read.

```ts
// api/account.get.ts
import { defineHandler, useEvent } from 'ohnejs';

export default defineHandler(() => useEvent().context.user, { middleware: ['require-auth'] });
```

Import from `ohnejs/auth` to type `event.context.user`. The type is optional, since a route without
the middleware never sets it, but with `require-auth` it is always present.

For a route that serves both signed-in users and guests, use `auth` instead. It loads the user into
`event.context.user` when there is one and leaves it unset otherwise. It never rejects a request.

## Sessions

A session is created when a user logs in, or when your signup calls `createSession`. Its token is
opaque: a random string that carries no data. It lives only in a `Secure`, `HttpOnly` cookie. The
`Sessions` row stores the sha256 hash of the token and an `expiresAt`, so a leaked database cannot
give anyone a usable session.

A request sends the token in the session cookie, or as a `Bearer` token in the
[`Authorization` header](../api/request.md#authorization) when there is no cookie, so a browser and
an API client both work.

How long a session lasts depends on [`remember`](#the-endpoints):

- A remembered sign-in lasts `auth.sessionMaxAge`.
- One without lasts `auth.transientSessionMaxAge`, whether it uses the cookie or `Bearer`, and its
  cookie also ends when the browser closes.

`auth.sessionMaxAge` is the ceiling: no session lasts longer than it, no matter how it was opened.

`logout` deletes the row, so the session is gone server-side, not just cleared from the browser. An
expired session is deleted the next time a request sends it, so an old cookie never resolves to a
user.

To manage sessions from your own code, import the same helpers the endpoints use:

```ts
import { createSession, destroySession, useSession } from 'ohnejs/auth';

await createSession(user.UUID);        // opens a remembered session and writes the cookie
await createSession(user.UUID, false); // the same, on the transient lifetime
await useSession();                    // the current session row, or null
await destroySession();                // ends the session and clears the cookie
```

## Configuration

The auth settings live under `auth` in [`ohne.config.ts`](../project/config.md):

```ts
import { defineConfig } from 'ohnejs';

export default defineConfig({
  auth: {
    sessionMaxAge: '30d',         // a remembered session's lifetime, and the ceiling
    transientSessionMaxAge: '1d', // the lifetime without remember me
    cookieName: 'session',        // the session cookie's name
  },
});
```

Every field is optional, and the values above are the defaults. Both lifetimes take a duration
string like `'2h'` or a number of milliseconds.

### Password hashing cost

Passwords are hashed with scrypt. `auth.password` sets how expensive the hashing is. Costlier
settings make a password harder to crack but make every sign-in slower.

```ts
auth: {
  password: {
    cost: 32768, // the main dial; higher is safer but slower
    blockSize: 8,
    parallelization: 1,
  },
},
```

You rarely need to change more than one setting. Leave `blockSize` and `parallelization` alone, and
raise `cost` (a power of two, so the next step is `65536`) until a sign-in takes about 100ms on your
server. That keeps hashing cheap for you and expensive for an attacker. An old password still works
after you raise the cost, because each stored hash includes the cost it was made with.

## Rolling your own

An app that does not [stack](../project/layers.md#consuming-a-layer) `ohnejs/base` has no `Users`
or `Sessions` collection, no `/auth` routes, and no `ohnejs/auth` helpers. Nothing reserves the
`Users` name or the `/auth` paths. Build the collection you want, hash with `hashPassword` from
`ohnejs/utils/crypto`, and write your own endpoints.

`dummyVerify` from `ohnejs/auth` is worth reusing even then. On your login's "no such user" path, it
takes as long as a real password check, so timing cannot reveal which emails have an account.
