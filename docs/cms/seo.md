# SEO and redirects

The CMS gives your website what search engines ask for: the `<head>` of each page, redirects, a
sitemap, and `robots.txt`. Your editors manage it in the dashboard.

## Site settings

The `Site` page in the dashboard holds settings for the whole website:

- **Site name** - shown in page titles.
- **Title template** - how each title reads. `{title} | {site}` turns `About` into `About | Acme`.
- **Default description** and **Default share image** - for a page without its own.
- **Hide the site from search engines** - for a staging site, or one not launched yet.

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

When a page moves, add a redirect in the dashboard's **Redirects** collection:

- **From** - the old path, like `/old-page`.
- **To** - a path on the website, or a full URL.
- **Status** - `301` by default. Use `302` or `307` for a temporary move.
- **Keep the query** - carries `?query` parameters over to the target.

`resolve` checks the redirects before any page. Your website handles the `redirect` kind once, as
every recipe in [Frameworks](./frameworks.md) does, and never a single redirect by hand.

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
