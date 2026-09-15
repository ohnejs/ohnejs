# Authentication

The ohne layer ships email and password authentication: a `Users` collection, session cookies, the
sign-in endpoints, and helpers to read the signed-in user. Stack the ohne layer and it is there.
Leave it out and none of it exists, so you are free to build your own.

You never store a password. The `password` field hashes it with scrypt when an account is written,
and `login` verifies against the hash. A session is an opaque token in a `Secure`, `HttpOnly`
cookie, and only its hash is stored, so a leaked database cannot hand back a usable session.

Creating accounts is left to you - it varies too much between apps to ship one way, from invite-only
signups to email verification to accepting terms. The framework gives you the `Users` collection and
the pieces to build it, covered in [creating accounts](#creating-accounts).

## The endpoints

These routes cover the sign-in flow, the account, and first-user setup. Each speaks JSON.

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

The dashboard's [install page](./roles.md#assigning-roles) drives the install routes.

The user is one shape everywhere: `UUID`, `email`, the [role names](./roles.md), and the
[account settings](../dashboard/account.md) - `dashboardLanguage`, `contentLanguage`, `timezone`,
`dateFormat`, `timeFormat`, and `smartClipboard`. A response never carries the password hash.

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
account, and `login` matches either.

`PATCH /auth/me` accepts the fields the `auth:account-fields` hook allows, by default the account
settings and `password`. The write runs through the field pipeline, so a bad time zone or a blank
format answers `422` exactly as a collection write would, and a new password is hashed before it is
stored. Changing the password asks for no confirmation of the current one. `email` and `roles` are
not accepted: an administrator changes those through the `Users` collection.

`remember` asks for a lasting session. Omit it and the sign-in counts as not remembered, so a
scripted client that never sends it gets the shorter lifetime described under [sessions](#sessions).

`login` answers `401` for both a wrong password and an unknown email, with the same message, so a
caller cannot probe which emails exist.

## Creating accounts

The framework ships no signup endpoint - account creation is where apps differ, so you write it. The
`Users` collection and the same helpers the sign-in flow uses give you the pieces:

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
stored, so the plaintext never lands anywhere - there is no hashing step to remember. The field is
write-only (`readable: false`), so no read returns the hash - not even `record` here.

`createOrThrow` runs the collection's own email validation and its unique constraint, so a bad or
duplicate email answers `422` with per-field messages. `createSession` writes the session cookie,
exactly as `login` does, and `toUser` answers the same `User` shape `login` returns.

A new account holds no [roles](./roles.md) unless you pass some, like `roles: ['editor']`. The first
administrator comes from the install page; see [assigning roles](./roles.md#assigning-roles).

## Adding fields to `Users`

Your own `collections/Users.ts` replaces the ohne layer's `Users` collection whole. Spread
`usersDefinition` from `ohnejs/auth` to keep the fields sign-in and the account page read, then add
yours:

```ts
// collections/Users.ts
import { defineCollection, field } from 'ohnejs';
import { usersDefinition } from 'ohnejs/auth';

export default defineCollection({
  ...usersDefinition,
  fields: { ...usersDefinition.fields, name: field('text', { nullable: true }) },
});
```

Make an added field `nullable: true` or give it a `default`: the install page creates the first
admin from an email and a password alone. [`useUser`](#reading-the-current-user) returns the
`User` shape without your fields, so read them with `query('Users')`.

## Reading the current user

Inside your own [route handler](../api/routes.md), reach for the current user with `useUser`. It
returns the user, typed as `User` from `ohnejs/auth`, or `null` when the request has no live session.
Outside a request, in a boot file or a script, there is no session to read, so it resolves to
`null` there too.

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

Both read the session once per request and answer the public user shape, never the password hash,
so their result is safe to return as-is. To ask what the user may do, not just who they are, see
[roles and capabilities](./roles.md).

### Protecting routes with middleware

Rather than call `requireUser` in every protected handler, opt the route into the `require-auth`
[middleware](../api/middleware.md). It answers `401` when there is no session, so the handler runs
only for a signed-in request, and it sets `event.context.user` for the handler to read.

```ts
// api/account.get.ts
import { defineHandler, useEvent } from 'ohnejs';

export default defineHandler(() => useEvent().context.user, { middleware: ['require-auth'] });
```

`event.context.user` is typed once you import from `ohnejs/auth`. It is optional, since a route without
the middleware never sets it, but behind `require-auth` it is always present.

For a route that serves both signed-in users and guests, opt into `auth` instead. It loads the user
into `event.context.user` when there is one and leaves it unset otherwise, never rejecting.

## Sessions

A session is created when a user logs in, or when your signup calls `createSession`. The raw token
lives only in the cookie; the `Sessions` row stores its sha256 and an `expiresAt`. A request
presents the token in the session cookie, or as a `Bearer` token in the `Authorization` header when
there is no cookie, so a browser and an API client both work.

How far out that `expiresAt` sits depends on `remember`. A remembered sign-in lasts
`auth.sessionMaxAge`, one without lasts `auth.transientSessionMaxAge`, and the shorter one's cookie
also ends with the browser. `auth.sessionMaxAge` is the ceiling: no session outlives it, however it
was opened.

That covers the `Bearer` path too: a token from a sign-in that was not remembered stops working at
the shorter mark, cookie or header alike.

`logout` deletes the row, so the session is gone server-side, not just cleared from the browser. An
expired session is deleted the next time it is presented, so a stale cookie never resolves to a user.

To manage sessions from your own code, the same helpers the endpoints use are exported:

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

Every field is optional; the values above are the defaults. Both lifetimes take a duration string
like `'2h'` or a number of milliseconds.

### Password hashing cost

Passwords are hashed with scrypt. `auth.password` tunes how hard that is - costlier settings resist
cracking better but make every sign-in slower.

```ts
auth: {
  password: {
    cost: 32768, // the main dial; higher is safer but slower
    blockSize: 8,
    parallelization: 1,
  },
},
```

You rarely need more than one knob. Leave `blockSize` and `parallelization` alone, and raise `cost`
(a power of two, so the next step is `65536`) until a sign-in takes about 100ms on your server. That
keeps hashing cheap for you and expensive for an attacker. An old password still verifies after you
raise the cost, because each stored hash carries the cost it was made with.

## Rolling your own

The `Users` and `Sessions` collections, the `/auth` routes, and the `ohnejs/auth` helpers all come
from the ohne layer. An app that does not [stack](../project/layers.md) it has none of them, and
nothing reserves the `Users` name or the `/auth` paths. Build the collection you want, hash with
`hashPassword` from `ohnejs/utils/crypto`, and write your own endpoints.

`dummyVerify` from `ohnejs/auth` is worth reusing even then. It spends a real password check's worth
of time on your login's "no such user" path, so timing cannot reveal which emails have an account.
