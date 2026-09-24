# ICU MessageFormat

ICU MessageFormat is a small grammar for writing translatable strings. One string holds every form
the sentence can take: singular and plural, masculine and feminine, short and long dates. The
renderer picks the right form at runtime from the inputs you pass.

It is the syntax of every value in ohne's [message catalogs](./messages.md#templates). This page
teaches it from the beginning. Examples call `formatMessage(template, params, language)` from
`ohnejs/utils`, but the syntax is identical anywhere ICU is supported.

## Plain text

The simplest message is a string. No special characters, nothing to render.

```ts
import { formatMessage } from 'ohnejs/utils';

formatMessage('Welcome back.', undefined, 'en');
// -> 'Welcome back.'
```

## Placeholders

Wrap a name in `{ }` and the value comes from the params object.

```ts
formatMessage('Hello, {name}.', { name: 'Sylvanas' }, 'en');
// -> 'Hello, Sylvanas.'
```

A message can carry many placeholders, in any order.

```ts
formatMessage('{verb} the {kind}.', { verb: 'Open', kind: 'door' }, 'en');
// -> 'Open the door.'
```

## Plurals

English has two number forms (one apple, two apples). Russian has three. Arabic has six. Hard-coding
"1 item" / "N items" stops working as soon as you translate.

ICU plurals let you write every form once and pick by category at runtime.

```ts
const msg = '{n, plural, one {# item} other {# items}}';

formatMessage(msg, { n: 1 }, 'en'); // -> '1 item'
formatMessage(msg, { n: 5 }, 'en'); // -> '5 items'
```

The shape is `{name, plural, case1 {body1} case2 {body2} ...}`. Inside a case body, `#` is the
number itself, formatted for the language.

The case keywords are `zero`, `one`, `two`, `few`, `many`, and `other`. Each language uses a subset.
`other` is required: it is the fallback when no other case matches.

The same message in Russian uses three forms:

```ts
const msg = '{n, plural, one {# файл} few {# файла} many {# файлов} other {# файла}}';

formatMessage(msg, { n: 1 }, 'ru'); // -> '1 файл'
formatMessage(msg, { n: 3 }, 'ru'); // -> '3 файла'
formatMessage(msg, { n: 5 }, 'ru'); // -> '5 файлов'
```

### Exact matches

Sometimes you want a specific number to render differently. `=N` matches before the plural rules
run.

```ts
const msg = `{n, plural, =0 {No messages.} one {# new message.} other {# new messages.}}`;

formatMessage(msg, { n: 0 }, 'en'); // -> 'No messages.'
formatMessage(msg, { n: 1 }, 'en'); // -> '1 new message.'
formatMessage(msg, { n: 7 }, 'en'); // -> '7 new messages.'
```

## Ordinals

For "1st", "2nd", "3rd", use `selectordinal`. It has the same shape as `plural`, but picks the case
by ordinal rules.

```ts
const msg = '{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}';

formatMessage(msg, { n: 1 }, 'en');  // -> '1st'
formatMessage(msg, { n: 2 }, 'en');  // -> '2nd'
formatMessage(msg, { n: 3 }, 'en');  // -> '3rd'
formatMessage(msg, { n: 11 }, 'en'); // -> '11th'
formatMessage(msg, { n: 22 }, 'en'); // -> '22nd'
```

## Select

When the message depends on a value that is not a number, like a role, a gender, or a status, use
`select`. It matches the parameter as a string against case keywords.

```ts
const msg = `{role, select,
  admin {You can edit anything.}
  guest {You can view this page.}
  other {You can edit your own posts.}
}`;

formatMessage(msg, { role: 'admin' }, 'en');  // -> 'You can edit anything.'
formatMessage(msg, { role: 'member' }, 'en'); // -> 'You can edit your own posts.'
```

`other` is required, same as `plural`.

## Offsets

In a `plural`, `offset:N` subtracts N from the value before the category is picked and before `#`
is rendered. It is useful for messages like "you and N others".

```ts
const msg = `You {n, plural, offset:1
  =1 {are the only one here}
  =2 {and one other are here}
  other {and # others are here}
}`;

formatMessage(msg, { n: 1 }, 'en'); // -> 'You are the only one here'
formatMessage(msg, { n: 2 }, 'en'); // -> 'You and one other are here'
formatMessage(msg, { n: 5 }, 'en'); // -> 'You and 4 others are here'
```

`=N` matches the raw input. Keyword cases and `#` see the value after the subtraction.

## Numbers

`{n, number}` formats with the locale's default decimal style.

```ts
formatMessage('{n, number}', { n: 1234.5 }, 'en'); // -> '1,234.5'
formatMessage('{n, number}', { n: 1234.5 }, 'de'); // -> '1.234,5'
```

A predefined style changes the format.

```ts
formatMessage('{n, number, integer}', { n: 12.7 }, 'en'); // -> '13'
formatMessage('{n, number, percent}', { n: 0.42 }, 'en'); // -> '42%'
```

For currencies, units, compact notation, and digit control, use a skeleton with the `::` prefix.

```ts
formatMessage('{amount, number, ::currency/EUR}', { amount: 19.5 }, 'de'); // -> '19,50 €'
formatMessage('{n, number, ::compact-short}', { n: 12500 }, 'en');          // -> '13K'
formatMessage('Pi is about {n, number, ::.000}', { n: Math.PI }, 'en');     // -> 'Pi is about 3.142'
```

The gap in `19,50 €` is a no-break space, exactly as `Intl` produces it.

Skeletons are their own small language:

- `.00` always shows two fraction digits.
- `currency/USD` sets the currency.
- `group-off` disables thousands separators.

## Dates and times

`{d, date}` and `{d, time}` accept a predefined style: `short`, `medium`, `long`, or `full`. The
default is `medium`. Dates format in the machine's local timezone.

```ts
const d = new Date('2026-06-09T14:30:00');

formatMessage('{d, date, short}', { d }, 'en'); // -> '6/9/26'
formatMessage('{d, date, long}', { d }, 'en');  // -> 'June 9, 2026'
formatMessage('{d, time, short}', { d }, 'en'); // -> '2:30 PM'
```

For more control, use a CLDR skeleton with `::`. The number of letters picks the variant: `MMM` is
the short month, `MMMM` is the long one.

```ts
const d = new Date('2026-06-09T14:30:00');

formatMessage('{d, date, ::yMMMd}', { d }, 'en'); // -> 'Jun 9, 2026'
formatMessage('{d, time, ::HH:mm}', { d }, 'en'); // -> '14:30'
```

The locale chooses the order. `::yMMMd` is "Jun 9, 2026" in English and "9 juin 2026" in French, and
you don't write that ordering yourself.

## Nesting

Plural and select bodies are themselves messages. Nest freely.

```ts
const msg = `{count, plural,
  one {You have # {kind, select, photo {photo} video {video} other {file}}}
  other {You have # {kind, select, photo {photos} video {videos} other {files}}}
}`;

formatMessage(msg, { count: 1, kind: 'photo' }, 'en'); // -> 'You have 1 photo'
formatMessage(msg, { count: 7, kind: 'video' }, 'en'); // -> 'You have 7 videos'
```

## Escaping

`{`, `}`, and (inside a plural) `#` are special. To write them literally, wrap them in single
quotes. Two apostrophes (`''`) render one.

```ts
formatMessage("Use '{name}' to interpolate.", undefined, 'en'); // -> 'Use {name} to interpolate.'
formatMessage("It''s fine.", undefined, 'en');                  // -> "It's fine."
formatMessage("It's {n, number} o'clock.", { n: 5 }, 'en');     // -> "It's 5 o'clock."
```

An apostrophe only opens an escape when the next character would otherwise be special. Normal
apostrophes stay as they are.

## Missing parameters

Formatting never throws because of a missing value:

- A plain placeholder, and `number`, `date`, and `time`, render as their `{name}` placeholder:
  `Hello, {name}.` stays `Hello, {name}.`.
- `plural` formats the value as zero.
- `select` uses `other`.

To catch these instead, pass an `onError` hook in the options argument. `formatMessage` takes it as
its last argument, and `createMessageFormatter(language, options)` binds a language and options
once. `onError` is called for every failure that does not throw, and throwing from it makes
formatting strict:

```ts
const strict = createMessageFormatter('en', {
  onError: (error) => { throw error; },
});

strict('Hello, {name}.', {}); // throws: missing parameter `name`
```

## Putting it together

A realistic message uses several of these at once.

```ts
import { createMessageFormatter } from 'ohnejs/utils';

const t = createMessageFormatter('en');

const msg = `{user} {n, plural, offset:1
  =1 {is here alone}
  =2 {and one other person are here}
  other {and # others are here}
}, last seen {seen, date, ::yMMMd}.`;

t(msg, { user: 'Varian', n: 4, seen: new Date('2026-06-09T00:00:00') });
// -> 'Varian and 3 others are here, last seen Jun 9, 2026.'
```
