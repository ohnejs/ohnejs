import { slugify, type SlugifyOptions } from './slugify.ts';

const EXTENSION = /^[A-Za-z0-9]{1,8}$/;

/**
 * Slugifies a file name, keeping its extension.
 *
 * The extension is what follows the last dot when that is one to eight ASCII letters or digits.
 * It is lowercased and re-attached; everything before the dot is the stem.
 * A dotfile such as `.env` has no extension, so the whole name is the stem.
 *
 * The stem is split on dots and each part goes through `slugify`, so inner dots survive.
 * Empty parts are dropped, so no `.` or `..` segment survives.
 * A stem that slugifies to nothing becomes `file`.
 *
 * `options` are passed to `slugify`; a `replace` map such as `slugGerman` applies to the stem.
 *
 * @example
 * ```ts
 * slugifyFileName('Sunset At Beach.JPG')                    // -> 'sunset-at-beach.jpg'
 * slugifyFileName('my.photo.v2.jpeg')                       // -> 'my.photo.v2.jpeg'
 * slugifyFileName('.env')                                   // -> 'env'
 * slugifyFileName('../etc/passwd')                          // -> 'etc-passwd'
 * slugifyFileName('')                                       // -> 'file'
 * slugifyFileName('Übersicht.pdf', { replace: slugGerman }) // -> 'uebersicht.pdf'
 * ```
 */
export function slugifyFileName(name: string, options?: SlugifyOptions): string {
  const trimmed = name.trim();
  const dot = trimmed.lastIndexOf('.');
  const split = dot > 0 && EXTENSION.test(trimmed.slice(dot + 1));
  const stem = split ? trimmed.slice(0, dot) : trimmed;

  const slug =
    stem
      .split('.')
      .map((part) => slugify(part, options))
      .filter(Boolean)
      .join('.') || 'file';

  return split ? `${slug}.${trimmed.slice(dot + 1).toLowerCase()}` : slug;
}
