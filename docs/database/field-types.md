# Custom field types

A field type is the contract behind `field(...)`: how a value is stored, which options a field
takes, and how every write cleans and checks the value. Define your own when a value carries rules
you would otherwise repeat on every field that holds it - a slug, a color, a currency code.

```ts
// fields/slug.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'text',
  sanitizers: [(value) => value.trim().toLowerCase().replace(/\s+/g, '-')],
  validators: [
    (value) =>
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
        ? undefined
        : 'Must be lowercase words joined by hyphens',
  ],
});
```

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    slug: field('slug', { unique: true }),
  },
});
```

Every `slug` field now cleans and checks its value the same way, in whichever collection declares
it.

## Where types live

A field type lives in one file under `fields/` - each layer's `dirs.fields` directory, set in
[config](../project/config.md#directories) - and the file names it: `fields/slug.ts` defines
`slug`, `fields/hex-color.ts` defines `hexColor`. Codegen registers every type, so once
`ohne prepare` or `ohne dev` has run, `field('slug')` autocompletes and its options type-check.

A `_`-prefixed file is a helper the scan skips, so code your types share can sit beside them. A
type in a closer [layer](../project/layers.md) replaces a further layer's type of the same name,
built-in types included.

## Options

`options` declares what a `field(...)` call may pass, each entry made with `option()`. Your
callbacks read the resolved values from `ctx.options`:

```ts
// fields/handle.ts
import { defineField, option } from 'ohnejs';

export default defineField({
  columnType: 'text',
  options: {
    max: option({ default: 30 }),
  },
  validators: [(value, ctx) => (value.length > ctx.options.max ? 'Too long' : undefined)],
});
```

```ts
fields: {
  handle: field('handle', { max: 20 }),
}
```

An option with a `default` is optional, and `ctx.options` always holds a value for it. An option
declared with `required: true` must be passed, or the `field(...)` call does not type-check. One
with neither stays absent when omitted. The value type comes from the default, widened to its
primitive, so pass a generic to keep a union: `option<'soft' | 'hard'>({ default: 'soft' })`.

Option names are camelCase, and none may reuse the name of an option every field already takes -
`nullable`, `default`, `label`, and the rest.

## Storage

`columnType` picks the column the value lands in: `text`, `integer`, `real`, `boolean`, or `json`.
A write converts input toward that type and rejects what does not fit before your code runs, so
the sanitizers and validators of a `text` type always receive a string.

A `json` column accepts any value, so its validators check the shape. Its value types as `unknown`
unless `emitType` returns the TypeScript type as source:

```ts
// fields/labels.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'json',
  jsonList: true,
  defaultValue: () => [],
  emitType: () => 'string[]',
  validators: [
    (value) =>
      Array.isArray(value) && value.every((label) => typeof label === 'string')
        ? undefined
        : 'Must be a list of labels',
  ],
});
```

`jsonList: true` marks a `json` value a list, so a query probes it with `includes`,
`includesAll`, and `includesAny`. Neither the flag nor `emitType` checks anything at runtime - the
validators are what keep the value the shape its type promises.

`serialize` and `deserialize` convert between the value and what the column stores. `serialize`
runs after the validators, so they check the value before it is encoded: the `password` type hashes
there.

A type that references another collection returns a storage layout from `schema` instead:
`columnType: 'text'` with a `foreignKey`, or `columnType: false` with a `junction`, the way the
uploads layer's `image` and `images` types do. The value type then follows from the layout, so such
a type declares no `emitType`.

## Defaults

`defaultValue` is what a create stores in the field's column when its input leaves the field out:

```ts
// fields/rating.ts
import { defineField } from 'ohnejs';

export default defineField({ columnType: 'integer', defaultValue: 0 });
```

Pass a value, or a callback that computes one from `ctx`: the field's `options`, the record's raw
`input`, and the `operation`. A field's own `default` replaces the type's; see
[writing records](./writing.md#defaults) for the full order. A default runs through the type's
sanitizers and validators like any value, so it must be one they accept. A literal default they
reject fails at boot. A callback default fails the create that computes it.

## Sanitizers and validators

A type cleans and checks its value through ordered lists of `sanitizers` and `validators`. A
sanitizer returns the cleaned value and never rejects. A validator returns a message to reject the
value, or `undefined` to accept it, and the first message stops the field. A message is a key, a
`{ key, params }` object, or a plain string - see
[validation messages](../i18n/messages.md#validation-messages).

`null` reaches neither list: a nullable field's `null` stores as is. Both receive `ctx` - the
field's `options`, the record's raw `input`, and the open transaction as `tx` - so a check can read
a sibling value as sent or query the database. The type's lists run before the ones a field adds,
and a failure in the type's lists skips the field's; see
[writing records](./writing.md#sanitizers-and-validators).

A returned message lands at the field's own name. A type whose value has parts reports inside it by
writing into `ctx.errors`, keyed by the sub-path:

```ts
// fields/address.ts
import { defineField } from 'ohnejs';

export default defineField({
  columnType: 'json',
  validators: [
    (value, ctx) => {
      const address = value as { city?: string };
      if (!address.city) ctx.errors.city = 'This value must not be empty';
    },
  ],
});
```

On a field named `address`, that failure lands at `address.city`. A key opening with `[` joins
without a dot, so `ctx.errors['[2]']` on a field named `labels` lands at `labels[2]`.

## In the dashboard

A type with a `text`, `integer`, `real`, or `boolean` column and no `schema` edits in the dashboard
like the matching built-in, with nothing to register. Any other type shows a notice in place of its
form control until a [dashboard boot file](../dashboard/pages.md#boot-files) registers one with
`registerFieldType`.
