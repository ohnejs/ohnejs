import { slugify, slugifyFileName } from 'ohnejs/utils';

/**
 * The name the server stores a folder under when asked for `name`, `''` when nothing in it can slug.
 * The server canonicalizes every name the same way, so the preview reads exactly what will land.
 *
 * @example
 * ```ts
 * storedFolderName('My Folder') // -> 'my-folder'
 * storedFolderName('!!!')       // -> ''
 * ```
 */
export function storedFolderName(name: string): string {
  return slugify(name) === '' ? '' : slugifyFileName(name);
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
  return slugifyFileName(extension === '' ? stem : `${stem}.${extension}`);
}
