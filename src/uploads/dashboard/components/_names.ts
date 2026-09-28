import { slugify, slugifyFileName } from 'ohnejs/utils';

// `canonicalName` in `uploads/path.ts` is never served to the browser, so its cap lives here too.
const MAX_NAME_BYTES = 255;

const EXTENSION = /^[A-Za-z0-9]{1,8}$/;

/**
 * The name the server stores a folder under when asked for `name`, `''` when nothing in it can slug.
 * The server canonicalizes every name the same way, so the preview reads exactly what will land.
 *
 * @example
 * ```ts
 * storedFolderName('My Folder')   // -> 'my-folder'
 * storedFolderName('Release 1.2') // -> 'release-1-2'
 * storedFolderName('!!!')         // -> ''
 * ```
 */
export function storedFolderName(name: string): string {
  const slug = slugify(name);
  return slug === '' ? '' : canonicalName(slug);
}

/**
 * The name the server stores a file under when its stem becomes `stem`; the extension is kept.
 * `''` when nothing in the stem can slug, since the extension alone is no name.
 *
 * @example
 * ```ts
 * storedFileName('My Photo', 'jpg') // -> 'my-photo.jpg'
 * storedFileName('notes', '')       // -> 'notes'
 * storedFileName('...', 'jpg')      // -> ''
 * ```
 */
export function storedFileName(stem: string, extension: string): string {
  if (slugify(stem) === '') return '';
  return canonicalName(extension === '' ? stem : `${stem}.${extension}`);
}

/**
 * Slugifies `value` as the server's `canonicalName` does, cutting a stem past 255 bytes.
 * A cut stem sheds the separators it ends in, and the extension stays.
 */
function canonicalName(value: string): string {
  const name = slugifyFileName(value);
  if (name.length <= MAX_NAME_BYTES) return name;
  const dot = name.lastIndexOf('.');
  const extension = dot > 0 && EXTENSION.test(name.slice(dot + 1)) ? name.slice(dot) : '';
  const stem = name.slice(0, name.length - extension.length);
  return stem.slice(0, MAX_NAME_BYTES - extension.length).replace(/[-.]+$/, '') + extension;
}
