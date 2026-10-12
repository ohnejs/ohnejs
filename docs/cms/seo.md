# SEO and redirects

The CMS gives your website what search engines ask for: the `<head>` of each page, redirects, a
sitemap, and `robots.txt`. Your editors manage it in the dashboard.

## Site settings

The `Site` page in the dashboard holds settings for the whole website:

- **Site name** - shown in page titles.
- **Title template** - how each title reads. `{title} | {site}` turns `About` into `About | Acme`.
- **Default description** and **Default share image** - for a page without its own.
- **Hide the site from search engines** - for a staging site, or one not launched yet.
- **Redirect moved pages** - on by default. See [When a page moves](#when-a-page-moves).

## A page's SEO

Each page has an **SEO** group with its own title, description, image, and a switch that hides
it from search engines. Without an SEO title, the page's `title` field fills the template.

`resolve` merges the page's SEO with the site's settings into `seo`:

```ts
const page = await ohne.resolve('/about');

page.seo;
// -> {
//   title: 'About us | Acme',
//   description: 'Who we are',
//   canonical: 'https://example.com/about',
// }
```

`seo.robots` is `'noindex'` when the page or the site is hidden. On a site with several locales,
`page.alternates` lists the page in each one, for `hreflang` links.

A website rendered on the server can write the tags in one call:

```ts
const head = ohne.renderHead(page);
// -> '<title>About us | Acme</title><meta name="description" content="Who we are">...'
```

## Redirects

A redirect sends a visitor from a path no page answers to somewhere else. Add one in the
dashboard's **Redirects** collection:

- **From** - the old path, like `/old-page`.
- **To** - a path on the website, or a full URL.
- **Status** - `301` by default. Use `302` or `307` for a temporary move.
- **Keep the query** - on by default. Carries the visitor's `?query` parameters over to the target,
  after any the target has of its own.

`resolve` tries the pages first and the redirects after. Your website handles the `redirect` kind
once, as every recipe in [Frameworks](./frameworks.md) does, and never a single redirect by hand.

Pass `resolve` the path with its query, as `/old?ref=x`, so a redirect can keep it. A preview token
follows a redirect within your site, and never one to another site.

### When a page moves

Change the slug of a published page, and the CMS leaves a `301` from its old path behind, so links
to it keep working. Rename `/about` to `/team`, and `/about?ref=x` now redirects to `/team?ref=x`.

- Only a live page leaves one. A draft or an expired page has no address worth keeping.
- A slug shared by every locale leaves one per locale, like `/about` and `/de/about`.
- Older redirects follow along. After `/a` becomes `/b` and then `/c`, both `/a` and `/b` lead
  straight to `/c`.
- Moving a page back is safe. The redirect from its old path goes, so the two paths never loop.

Turn it off with **Redirect moved pages** in the site settings. A change that is not a slug change,
like a new route pattern in your config, still needs its redirects added by hand.

### A page wins over a redirect

When a live page answers at a redirect's **From**, the page shows and the redirect waits. Once the
page is unpublished or expires, the redirect works again.

So you can schedule a new page at `/promo` while `/promo` still redirects to a sale. Until the page
goes live, visitors land on the sale; after that, they see the page. The dashboard says which one
wins: a page notes the redirect it replaces, and a redirect notes the page that holds its path.

## Sitemap and robots.txt

The CMS builds both from every page a visitor may see:

- `/cms/sitemap.xml` lists each page, with `hreflang` alternates between locales.
- `/cms/robots.txt` opens the site and names the sitemap.

A hidden page and the `404` page stay out of the sitemap. A hidden site lists nothing, and its
`robots.txt` closes everything.

Search engines look for both at your website's root, so serve them from there. In Next, a rewrite
does it:

```ts
// next.config.ts
import type { NextConfig } from 'next';

const api = process.env.OHNE_API;

export default {
  async rewrites() {
    return [
      { source: '/sitemap.xml', destination: `${api}/cms/sitemap.xml` },
      { source: '/robots.txt', destination: `${api}/cms/robots.txt` },
    ];
  },
} satisfies NextConfig;
```

The URLs inside use `cms.site`, so they point at your website, not at the API.
