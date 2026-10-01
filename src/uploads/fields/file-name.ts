import type { ConditionValue } from 'ohnejs/utils';

import { defineField, text } from 'ohnejs';
import { slugify } from 'ohnejs/utils';

import { canonicalFolderName, canonicalName } from '../uploads/path.ts';

/**
 * The `fileName` field type: a `text` value stored as its `canonicalName`.
 *
 * It takes every option and check of `text`.
 * Its sanitizer turns `Sunset At Sea.JPG` into `sunset-at-sea.jpg`.
 * Search canonicalizes each token as a file name and as a folder name.
 * So `Übersicht` finds `ubersicht-q3-final.pdf`, and `Release 1.2` the folder `release-1-2`.
 * A token with no letter or digit matches nothing.
 */
export default defineField({
  ...text,
  sanitizers: [canonicalName],
  search: ({ token }): ConditionValue | null => {
    const slug = slugify(token);
    if (slug === '') return null;
    const file = canonicalName(token);
    const folder = canonicalFolderName(token);
    // `canonicalName` names a stem with nothing to slug `file`, which would match every such name.
    const fallback = file.startsWith('file') && !slug.startsWith('file');
    if (fallback || file === folder) return { contains: folder };
    return { or: [{ contains: file }, { contains: folder }] };
  },
});
