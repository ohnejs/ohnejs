# Rich text

A `richText` field holds formatted text: paragraphs, headings, lists and quotes, with marks on the
text and links to addresses or to records. The value is a JSON tree, never HTML, so a write checks
it like any other value and a website renders it without trusting markup.

Reach for it when an author writes prose: an article body, a product description, a caption with a
link. A [`text`](./field-types.md#text) field holds a plain string.

```ts
// collections/Posts.ts
import { defineCollection, field } from 'ohnejs';

export default defineCollection({
  fields: {
    title: field('text'),
    body: field('richText'),
  },
});
```

`body` reads and writes as a `RichText` value, the type `ohnejs/utils` exports.

## The value

A value is a list of blocks. Each block holds runs, and a run is a stretch of text with its marks
and at most one link:

```ts
await query('Posts').create({
  title: 'Hello',
  body: [
    { kind: 'heading', level: 2, content: [{ text: 'Welcome' }] },
    {
      kind: 'paragraph',
      content: [
        { text: 'Read the ' },
        { text: 'guide', marks: ['strong'], link: { url: 'https://example.com/guide' } },
        { text: '.' },
      ],
    },
    { kind: 'list', ordered: false, items: [{ content: [{ text: 'One' }] }] },
  ],
});
```

- `paragraph`, `heading` and `quote` hold runs in `content`. A heading has a `level` from 2 to 6.
- `list` holds `items`, each with its own `content` and an optional nested `list`. `ordered` makes
  it numbered.
- `marks` holds any of `strong`, `em`, `del` and `code`. A `\n` in `text` is a line break.
- `[]` is the empty value, rejected unless `allowEmpty` is set.

A write normalizes the value before it checks it: neighbouring runs with the same marks and link
merge, empty runs drop, and empty blocks at the end of the document drop. A read returns that
canonical form. A value that breaks the shape fails at the exact path, like
`body[1].content[1].link.url`.

## Options

| Option       | Default                                  | What it does                                                                                           |
| ------------ | ---------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `inline`     | `false`                                  | Holds at most one paragraph, rendered without a `<p>`. `elements` does not apply.                      |
| `elements`   | `['h2', 'h3', 'ul', 'ol', 'blockquote']` | The block elements allowed besides paragraphs: `h2` to `h6`, `ul`, `ol` and `blockquote`.              |
| `marks`      | `['strong', 'em', 'code']`               | The marks allowed on text. `del` is strikethrough.                                                     |
| `links`      | `true`                                   | `false` allows no links, `true` allows addresses, and a list of collections also allows their records. |
| `lineBreaks` | `true`                                   | With `false`, each `\n` becomes a space.                                                               |
| `allowEmpty` | `false`                                  | Accepts `[]`.                                                                                          |
| `min`, `max` | -                                        | The fewest and most characters across all run text, counted like `String#length`.                      |

The options every field takes, like `nullable`, `default`, `translatable` and `when`, apply as they
do for [`text`](./field-types.md#text). A block, level or mark outside the options fails with
`invalidChoice` at its path.

```ts
fields: {
  summary: field('richText', { inline: true, marks: ['em'], links: false, max: 280 }),
}
```

## Links

A run's `link` has one of two shapes:

```ts
{ url: 'https://example.com/pricing', newTab: true }
{ collection: 'Pages', record: '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b', hash: 'pricing' }
```

- An address is a web, email or phone address, a local `/path` or a `#fragment`. Anything a browser
  could run, like `javascript:`, fails with `invalidLink`.
- A record link names a collection and a record's `UUID`. It follows the record wherever its page
  moves, and pins no locale.
- `newTab` opens the link in a new tab, and `hash` adds a fragment to the target's page.
- `href` is never stored: a write drops it, and a layer that serves the record's pages, like the
  [CMS](../cms/website.md#rich-text-and-links), sets it on read.

Record links need the `links` option to name their collections:

```ts
fields: {
  body: field('richText', { links: ['Pages', 'Posts'] }),
}
```

The value type narrows to `RichText<'Pages' | 'Posts'>`, so a link into any other collection is a
compile error, and an `invalidChoice` at `link.collection` over HTTP.

## The link field

A `link` field holds one link on its own, in the same two shapes. `collections` names the
collections it may point into, and without it only addresses are allowed:

```ts
fields: {
  cta: field('link', { collections: ['Pages'], nullable: true }),
}
```

The value type is `Link<'Pages'>`, and a bad address fails at `cta.url`.

## Checking record links

A record link is a weak reference. No foreign key holds it, so the rules differ from a
[`record`](./collections.md#one-reference) relation:

- A link the write provides is checked like a
  [relation](./writing.md#uniqueness-and-references): the target must exist, and through the
  collections API the caller must be able to read it. A failure is an `invalidReference` at the
  link's path, like `body[1].content[1].link`.
- A link that every matched record already holds is not checked, so a target deleted since never
  blocks the next save.
- Deleting a target neither cascades nor is blocked. The link stays in the value, and renders as
  plain text until the target comes back.
- [Copying a translation](./translations.md#copying-a-translation) checks the copied links as new.

## Rendering

`richTextToHTML` from `ohnejs/utils` renders a value as HTML, with every text and attribute
escaped:

```ts
// api/posts/[id].get.ts
import { defineHandler, notFound, query } from 'ohnejs';
import { richTextToHTML } from 'ohnejs/utils';

export default defineHandler(async ({ params }) => {
  const post = await query('Posts').where('UUID', params.id).findFirst();
  if (!post) throw notFound();
  return `<article>${richTextToHTML(post.body)}</article>`;
});
```

- A paragraph is a `<p>`, a heading an `<h2>` to `<h6>`, a quote a `<blockquote><p>`, and a list
  a `<ul>` or `<ol>` of `<li>`.
- Marks render as their elements, and a `\n` as `<br>`.
- An address link renders as `<a href>`. `newTab` adds `target="_blank" rel="noopener noreferrer"`.
- A record link renders as `<a>` only when it carries an `href`. Without one, its text renders
  plain.
- Pass `{ inline: true }` for an `inline` field, so the block tags are dropped.

`richTextToText` gives the plain text instead, blocks joined by a blank line.

## Limits

- Lists nest at most 4 levels deep.
- There is no `h1`, since the page title is the heading, and no underline, color or font.
- Neither field is searchable or filterable. Search never matches the value, and a nullable field
  takes only [`isNull`](./reading.md#null).
