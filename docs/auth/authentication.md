# Authentication

The ohne layer ships email and password authentication: a `Users` collection, session cookies, the
sign-in endpoints, and helpers to read the signed-in user. Stack the ohne layer and it is there.
Leave it out and none of it exists, so you are free to build your own.

You never store a password. You hash it with scrypt when you create an account, and `login` verifies
against the hash. A session is an opaque token in a `Secure`, `HttpOnly` cookie, and only its hash is
stored, so a leaked database cannot hand back a usable session.

Creating accounts is left to you - it varies too much between apps to ship one way, from invite-only
signups to email verification to accepting terms. The framework gives you the `Users` collection and
the pieces to build it, covered in [creating accounts](#creating-accounts).

## The endpoints

Three routes cover the sign-in flow. Each speaks JSON.

```bash
# Sign in. Returns the user and sets the session cookie.
POST /auth/login   { "email": "ada@example.com", "password": "correct horse", "remember": true }
# -> 200 { "UUID": "…", "email": "ada@example.com", "roles": [] }

# Sign out. Deletes the session and clears the cookie.
POST /auth/logout
# -> 200 { "ok": true }

# The signed-in user, read from the session cookie.
GET  /auth/me
# -> 200 { "UUID": "…", "email": "ada@example.com", "roles": [] }, or 401 when signed out
```

The email is stored trimmed and lowercased, so `Ada@Example.com` and `ada@example.com` are the same
account, and `login` matches either. A response never carries the password hash - only `UUID`,
`email`, and the [role names](./roles.md) cross the wire.

`remember` asks for a lasting session. Omit it and the sign-in counts as not remembered, so a
scripted client that never sends it gets the shorter lifetime described under [sessions](#sessions).

`login` answers `401` for both a wrong password and an unknown email, with the same message, so a
caller cannot probe which emails exist.

## Creating accounts

The framework ships no signup endpoint - account creation is where apps differ, so you write it. The
`Users` collection and the same helpers the sign-in flow uses give you the pieces:

```ts
// api/signup.post.ts
import { conflict, defineHandler, query, readJSONBody } from 'ohne';
import { createSession } from 'ohne/auth';

export default defineHandler(async () => {
  const { email, password } = await readJSONBody<{ email: string; password: string }>();
  // enforce whatever your app wants here: a length rule, an invite, a captcha...

  const result = await query('Users').create({ email, password });
  if (!result.ok) throw conflict(); // the email is taken

  await createSession(result.record.UUID);
  return { UUID: result.record.UUID, email: result.record.email };
});
```

You pass the password as plain text. The `password` field hashes it with scrypt just before it is
stored, so the plaintext never lands anywhere - there is no hashing step to remember. The field is
write-only (`readable: false`), so no read returns the hash - not even `result.record` here.

`create` runs the collection's own email validation and its unique constraint, so a bad or duplicate
email comes back as `result.ok === false`. `createSession` writes the session cookie, exactly as
`login` does.

A new account holds no [roles](./roles.md) unless you assign some: pass `roles: ['admin']` on the
create to bootstrap your first administrator.

## Reading the current user

Inside your own [route handler](../api/routes.md), reach for the current user with `useUser`. It
returns the user, or `null` when the request has no live session.

```ts
// api/profile.get.ts
import { defineHandler } from 'ohne';
import { useUser } from 'ohne/auth';

export default defineHandler(async () => {
  const user = await useUser();
  return user ? { email: user.email } : { guest: true };
});
```

When a route requires a user, `requireUser` returns it or throws `401`:

```ts
// api/account.get.ts
import { defineHandler } from 'ohne';
import { requireUser } from 'ohne/auth';

export default defineHandler(async () => {
  const user = await requireUser();
  return { UUID: user.UUID, email: user.email };
});
```

Both read the session once per request and carry only `UUID`, `email`, and `roles`, so their result
is safe to return as-is. To ask what the user may do, not just who they are, see
[roles and capabilities](./roles.md).

### Protecting routes with middleware

Rather than call `requireUser` in every protected handler, opt the route into the `require-auth`
[middleware](../api/middleware.md). It answers `401` when there is no session, so the handler runs
only for a signed-in request, and it sets `event.context.user` for the handler to read.

```ts
// api/account.get.ts
import { defineHandler, useEvent } from 'ohne';

export default defineHandler(() => useEvent().context.user, { middleware: ['require-auth'] });
```

`event.context.user` is typed once you import from `ohne/auth`. It is optional, since a route without
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
import { createSession, destroySession, useSession } from 'ohne/auth';

await createSession(user.UUID);        // opens a remembered session and writes the cookie
await createSession(user.UUID, false); // the same, on the transient lifetime
await useSession();                    // the current session row, or null
await destroySession();                // ends the session and clears the cookie
```

The second argument picks the lifetime, for the row and the cookie together. It defaults to `true`,
so your own signup opens a remembered session unless you pass `false`, while `POST /auth/login`
reads a missing `remember` as `false`.

## Configuration

The auth settings live under `auth` in [`ohne.config.ts`](../project/config.md):

```ts
import { defineConfig } from 'ohne';

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

The `Users` and `Sessions` collections, the `/auth` routes, and the `ohne/auth` helpers all come
from the ohne layer. An app that does not [stack](../project/layers.md) it has none of them, and
nothing reserves the `Users` name or the `/auth` paths. Build the collection you want, hash with
`hashPassword` from `ohne/utils/crypto`, and write your own endpoints.

Two helpers from `ohne/auth` are worth reusing even then. `createSession` and `destroySession` manage
the session cookie for you, and `dummyVerify` spends a real password check's worth of time on your
login's "no such user" path, so timing cannot reveal which emails have an account.
