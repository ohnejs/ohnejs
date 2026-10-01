import { defineField, text } from 'ohnejs';

import { canonicalDirectory } from '../uploads/path.ts';

/**
 * The `directoryName` field type: a `text` value stored as its `canonicalDirectory`.
 *
 * It takes every option and check of `text`.
 * Its sanitizer turns `Photos//2024 Summer/` into `photos/2024-summer`.
 * Search canonicalizes each token the same way, so `2024 Summer` finds `photos/2024-summer`.
 * A token with no letter or digit matches nothing.
 */
export default defineField({
  ...text,
  sanitizers: [canonicalDirectory],
  search: ({ token }) => {
    const canonical = canonicalDirectory(token);
    return canonical === '' ? null : { contains: canonical };
  },
});
