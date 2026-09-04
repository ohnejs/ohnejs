# Roles and capabilities

Authorization in ohne is capability-based. A capability is a permission string like
`collection.Posts.create`. A role is a named bundle of capabilities, defined in code. A user holds
any number of roles, and the capabilities of every held role union - what any role grants, the
user can do.

Roles live in your project, not in the database. They are policy, and policy is code: reviewed,
versioned, and typed like everything else. The database stores only the assignment - which role
names a user holds.

```ts
// roles/editor.ts
import { defineRole } from 'ohne';

export default defineRole({
  capabilities: ['collection.Posts.*', 'collection.Tags.read'],
});
```

A user with `roles: ['editor']` can now do anything on `Posts` and read `Tags`, both in the
[collections API](../api/collections.md) and behind any [guard you write](#guarding-your-own-routes).

## Capabilities

A capability is a dot-separated string. Every collection contributes four, one per operation, plus
a wildcard:

```
collection.Posts.read
collection.Posts.create
collection.Posts.update
collection.Posts.delete
collection.Posts.*
```

`collection.*` covers every collection capability, and `*` alone covers everything - that is what
makes an admin. Wildcards live on the granting side only: a role holds `collection.Posts.*`, but a
check always asks for one concrete capability.

Codegen derives these names from your collections, so they autocomplete wherever a capability is
expected. Any other dot-separated string is legal too - see
[custom capabilities](#custom-capabilities).

## Defining roles

Each `.ts` file under `roles/` is one role, named by its kebab-cased path: `roles/editor.ts` is
`editor`, `roles/shop/manager.ts` is `shop-manager`. The file default-exports a `defineRole`
result, and codegen types every name into `RoleName`, so assignments autocomplete and a typo is a
compile error.

The ohne layer ships one role: `admin`, holding `['*']`. There is no separate superuser flag - the
wildcard is the bypass. Your app can [override](../project/layers.md) it by shipping its own
`roles/admin.ts`, or drop it with `disable: { roles: ['admin'] }`.

## Assigning roles

The `Users` collection carries a `roles` field: the list of role names the user holds. It defaults
to `[]`, deduplicates on write, and rejects a name no role file defines. A role you later delete
from code simply grants nothing - a stale assignment degrades, it never breaks.

Adding a `roles` field to your own collection that already holds rows is the standard
new-required-field story: add it `nullable: true`, backfill, then drop the flag with a
[switch migration](../database/migrations.md#switching-an-attribute).

The first admin is one write from your own code, in a [boot file](../project/boot.md) or a signup
flow:

```ts
await query('Users').create({
  email: 'ada@example.com',
  password: 'correct horse',
  roles: ['admin'],
});
```

Because `Users` is itself exposed over the collections API, that first admin can then manage every
account over HTTP - creating users, assigning roles - guarded by the `collection.Users.*`
capabilities.

## The collections API guard

An operation a collection [exposes](../api/collections.md#exposure) is guarded by default: the
request needs a signed-in user whose capabilities cover `collection.<Name>.<operation>`. No user
is a `401`, a user without the capability a `403`. An operation marked `'public'` skips the guard.

The guard answers who may run an operation. Which records they reach - only their own posts, only
published ones - is the operation's [`access`](../api/collections.md#access) option.

## Guarding your own routes

For your own endpoints, `requireCapability` is the one-line guard. It resolves the signed-in user,
checks the capability against their union, and throws `401` or `403` exactly as the collections
API does:

```ts
// api/publish.post.ts
import { defineHandler } from 'ohne';
import { requireCapability } from 'ohne/auth';

export default defineHandler(async () => {
  await requireCapability('collection.Posts.update');
  return publishDrafts();
});
```

To branch instead of reject, `userCan` answers the same question as a boolean, and
`userCapabilities` returns the resolved union. Both are pure registry work over the user's roles -
no query runs:

```ts
import { requireUser, userCan, userCapabilities } from 'ohne/auth';

const user = await requireUser();
userCan(user, 'collection.Posts.update'); // -> true or false
userCapabilities(user);                   // -> ['collection.Posts.*', 'collection.Tags.read']
```

## Custom capabilities

A capability does not have to name a collection. Any dot-separated string works, so a feature can
carve its own namespace:

```ts
// roles/accountant.ts
import { defineRole } from 'ohne';

export default defineRole({
  capabilities: ['billing.read', 'billing.export'],
});
```

```ts
await requireCapability('billing.export');
```

A custom name needs no declaration to work, but nothing types it: codegen derives the known names
from your collections alone, so `billing.export` does not autocomplete. Declare it yourself with
the same `declare module` the other extension points take, in any file your `tsconfig.json`
includes:

```ts
// capabilities.ts
declare module 'ohne' {
  interface KnownCapabilities {
    'billing.read': true;
    'billing.export': true;
  }
}
```

Both names now complete in `defineRole`, `requireCapability`, and `userCan`, beside the generated
ones. The union stays open, so a name you did not declare still typechecks; the declaration buys
completion, not rejection. A [layer](../project/layers.md) declares its names the same way, and
codegen carries every `declare module 'ohne'` file a stacked layer ships into the app's type
program.

Prefix a layer's capabilities with its name and they cannot collide with an app's own.

## Roles across layers

Roles stack like everything a layer ships: each layer's `roles/` directory is scanned, a closer
layer's role replaces a further one's under the same name, and `disable: { roles: [...] }` drops
names entirely. The directory is configurable per layer as `dirs.roles`.
