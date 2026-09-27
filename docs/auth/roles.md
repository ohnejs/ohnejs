# Roles and capabilities

Authorization in ohne is capability-based. A capability is a permission string like
`collection.Posts.create`. A role is a named bundle of capabilities, defined in code:

```ts
// roles/editor.ts
import { defineRole } from 'ohnejs';

export default defineRole({
  capabilities: ['collection.Posts.*', 'collection.Tags.read'],
});
```

A user holds any number of roles and gets the union of their capabilities. A user with
`roles: ['editor']` can now do anything on `Posts` and read `Tags`, both in the
[collections API](../api/collections.md#exposure) and behind any
[guard you write](#guarding-your-own-routes).

Roles are policy, so they live in your project as code: reviewed, versioned, and typed like
everything else. The database stores only the assignment - which role names a user holds.

## Capabilities

A capability is a dot-separated string. Every collection adds one per operation, plus a wildcard:

```
collection.Posts.read
collection.Posts.create
collection.Posts.update
collection.Posts.delete
collection.Posts.*
```

- `collection.*` covers every collection capability.
- `*` alone covers everything. A user who holds it is an admin.
- Only roles use wildcards: a role holds `collection.Posts.*`, but a check always asks for one
  concrete capability.
- A [singleton](../database/collections.md#singletons) adds `read` and `update` only.
- A role that links records of a collection over the
  [collections API](../api/collections.md#the-scope) needs `read` on it too, as
  `collection.Tags.read` does for the [editor](#labels) below.

[Codegen](../project/cli.md#ohne-prepare) generates these names from your collections, so they
autocomplete wherever a capability is expected.
[Any other dot-separated string](#custom-capabilities) is allowed too.

## Defining roles

Each `.ts` file under `roles/` is one role, named by its kebab-cased path: `roles/editor.ts` is
`editor`, `roles/shop/manager.ts` is `shop-manager`. The file default-exports a `defineRole`
result. Codegen types every name into `RoleName`, so assignments autocomplete and a typo is a
compile error.

The `ohnejs/base` layer ships the `admin` role, holding `['*']`. There is no separate superuser
flag. The wildcard is what lets an admin pass every check. Your app can
[override](../project/layers.md#what-overrides-what) it by shipping its own `roles/admin.ts`, or
drop it with [`disable: { roles: ['admin'] }`](../project/config.md#disabling).

## Labels

The dashboard names a role by its `label` wherever it picks or lists roles, and shows the
`description` as a hint in the picker:

```ts
// roles/editor.ts
import { defineRole } from 'ohnejs';

export default defineRole({
  label: 'app.roles.editor.label',
  description: 'app.roles.editor.description',
  capabilities: ['collection.Posts.*', 'collection.Tags.read'],
});
```

Both are [messages](../i18n/messages.md): a catalog key is translated for each viewer, and a plain
string is shown unchanged. If you leave out the label, the name is sentence-cased, so
`content-editor` reads `Content editor`.

## Assigning roles

The `Users` collection has a [`roles`](../database/field-types.md#roles) field, the list of role
names the user holds:

- It defaults to `[]` and removes duplicate names on write.
- It rejects a name that no role file defines.
- A role you later delete from code simply grants nothing. The old assignment loses its effect, but
  it never causes an error.

The first admin needs no code: the dashboard's [install page](./authentication.md#the-endpoints)
creates it.

`Users` is itself [exposed over the collections API](../api/collections.md#exposure), so the first
admin can then manage every account over HTTP: creating users, assigning roles. The
`collection.Users.*` capabilities guard these operations.

Adding a `roles` field to your own collection that already holds rows works like adding any new
required field: add it with [`nullable: true`](../database/collections.md#column-fields), fill the
existing rows, then remove the flag with a
[switch migration](../database/migrations.md#switching-an-attribute).

## Delegating user management

You can hand user management to a role that is not an admin. The grant rule keeps that role from
reaching past its own capabilities: you can grant a role only when your own capabilities cover every
capability it lists, and you can edit or delete a user only when you could grant every role they
hold.

```ts
// roles/support.ts
import { defineRole } from 'ohnejs';

export default defineRole({
  capabilities: ['collection.Users.*', 'collection.Posts.*'],
});
```

A user holding `support` can create, edit, and delete users whose roles it covers, `support` itself
included, and view every user. It cannot:

- grant `admin`. The write answers `422`, with an error at each offending `roles[n]`.
- edit or delete an admin, who answers `404`.

If you [replace the `Users` collection](./authentication.md#adding-fields-to-users), keep
`manageUsers` on its writes.

## The collections API guard

An operation that a collection [exposes](../api/collections.md#exposure) is guarded by default: the
request needs a signed-in user whose capabilities cover `collection.<Name>.<operation>`.

- A request with no user gets a `401`.
- A user without the capability gets a `403`.
- An operation marked `'public'` skips the guard.

The guard decides who may run an operation. The operation's [`access`](../api/collections.md#access)
option decides which records they reach, for example only their own posts or only published ones.

## Guarding your own routes

For your own endpoints, `requireCapability` is the one-line guard. It gets the
[signed-in user](./authentication.md#reading-the-current-user), checks the capability against the
user's capabilities, and throws `401` or `403` exactly as the collections API does:

```ts
// api/publish.post.ts
import { defineHandler } from 'ohnejs';
import { requireCapability } from 'ohnejs/auth';

export default defineHandler(async () => {
  await requireCapability('collection.Posts.update');
  return publishDrafts();
});
```

To branch instead of rejecting, `userCan` answers the same question with a boolean, and
`userCapabilities` returns every capability the user's roles grant. Both work from the user's roles
and the role files, so no query runs:

```ts
import { requireUser, userCan, userCapabilities } from 'ohnejs/auth';

const user = await requireUser();
userCan(user, 'collection.Posts.update'); // -> true or false
userCapabilities(user);                   // -> ['collection.Posts.*', 'collection.Tags.read']
```

## Custom capabilities

A capability does not have to name a collection. Any dot-separated string works, so a feature can
use its own namespace:

```ts
// roles/accountant.ts
import { defineRole } from 'ohnejs';

export default defineRole({
  capabilities: ['billing.read', 'billing.export'],
});
```

```ts
await requireCapability('billing.export');
```

A custom name works without any setup, but it does not autocomplete, because codegen generates the
known names only from your collections. To get completion, declare it in any file your
`tsconfig.json` includes, with the same `declare module` the other extension points use:

```ts
// capabilities.ts
declare module 'ohnejs' {
  interface KnownCapabilities {
    'billing.read': true;
    'billing.export': true;
  }
}
```

Both names now complete in `defineRole`, `requireCapability`, and `userCan`, beside the generated
ones. The union stays open, so a name you did not declare still typechecks. The declaration adds
completion. It does not make other names an error.

## Roles across layers

Roles [stack](../project/layers.md#what-overrides-what) like everything a layer ships:

- Each layer's `roles/` directory is scanned. The directory is configurable per layer as
  [`dirs.roles`](../project/config.md#directories).
- A closer layer's role replaces a further layer's role with the same name.
- `disable: { roles: [...] }` drops names entirely.

A [layer](../project/layers.md#new-config-keys) declares its custom capability names the same way an
app does. Prefix them with the layer's name, and they cannot collide with an app's own.
