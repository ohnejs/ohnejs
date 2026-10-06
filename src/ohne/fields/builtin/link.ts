import type { CollectionName } from '../../collections/known-collections.ts';

import { checkLink, isLink, isRecordLink, normalizeLink } from '../../../utils/index.ts';
import { defineField } from '../define-field.ts';
import { linksParameter, registeredLinks } from '../link-collections.ts';
import { option } from '../option.ts';
import { reportIssues } from '../report-issues.ts';

/**
 * The built-in `link` field type: a link to a record or to an address, stored as JSON.
 *
 * The value is a `Link`: `{ collection, record }` for a record, `{ url }` for an address.
 * A write normalizes a well-shaped value, then checks it: a URL must pass `isSafeHref`.
 * A failure lands at its key inside the value, so `url` names the address itself.
 * A record link is a weak reference: a new one must exist and be within reach.
 * A link the matched records already hold is never checked, and deleting its target never blocks.
 * An optional link is a nullable field.
 * The value type is `Link<C>`, where `C` is the union of `collections`.
 * Word search never matches the value.
 */
export const link = defineField({
  columnType: 'json',
  search: false,
  options: {
    /**
     * The collections whose records may be linked, besides addresses.
     * Omitted, only addresses are allowed.
     */
    collections: option<readonly CollectionName[]>(),
  },
  emitType: (ctx) =>
    `${ctx.importType('ohnejs/utils', 'Link')}<${linksParameter(ctx.options.collections ?? true)}>`,
  sanitizers: [(value) => (isLink(value) ? normalizeLink(value) : value)],
  validators: [
    (value, ctx) =>
      reportIssues(checkLink(value, registeredLinks(ctx.options.collections ?? true)), ctx.errors),
  ],
  links: (value) => (isRecordLink(value) ? [{ path: '', link: value }] : []),
});
