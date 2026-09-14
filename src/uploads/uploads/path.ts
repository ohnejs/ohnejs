import { slugify, slugifyFileName, uniqueName } from 'ohnejs/utils';

/**
 * A row's location: its parent path and its name, the pair the composite unique index covers.
 */
export interface UploadLocation {
  /**
   * The parent path with no leading slash, `''` at the root.
   */
  directory: string;

  /**
   * The file or folder name.
   */
  name: string;
}

/**
 * The storage prefix staged bytes wait under until their row commits.
 */
export const TEMP_PREFIX = '.tmp';

const EXTENSION = /^[A-Za-z0-9]{1,8}$/;

/**
 * Canonicalizes a directory path exactly as the `Uploads` collection's sanitizer does.
 * Every segment becomes a slug, empty segments drop, and no slash survives at either end.
 *
 * @example
 * ```ts
 * canonicalDirectory('Photos//2024 Summer/') // -> 'photos/2024-summer'
 * canonicalDirectory('/')                    // -> ''
 * ```
 */
export function canonicalDirectory(value: string): string {
  return value
    .split('/')
    .map((segment) => slugify(segment))
    .filter(Boolean)
    .join('/');
}

/**
 * Canonicalizes a name exactly as the `Uploads` collection's sanitizer does.
 * The extension stays, lowercased; every other part becomes a slug.
 *
 * @example
 * ```ts
 * canonicalName('Sunset At Sea.JPG') // -> 'sunset-at-sea.jpg'
 * ```
 */
export function canonicalName(value: string): string {
  return slugifyFileName(value);
}

/**
 * Joins a location into its path, the storage key and the URL tail of a file.
 *
 * @example
 * ```ts
 * uploadPath({ directory: 'photos/2024', name: 'sunset.jpg' }) // -> 'photos/2024/sunset.jpg'
 * uploadPath({ directory: '', name: 'sunset.jpg' })            // -> 'sunset.jpg'
 * ```
 */
export function uploadPath(location: UploadLocation): string {
  return location.directory === '' ? location.name : `${location.directory}/${location.name}`;
}

/**
 * Splits a path at its last slash into the location it names.
 *
 * @example
 * ```ts
 * splitUploadPath('photos/2024/sunset.jpg') // -> { directory: 'photos/2024', name: 'sunset.jpg' }
 * splitUploadPath('sunset.jpg')             // -> { directory: '', name: 'sunset.jpg' }
 * ```
 */
export function splitUploadPath(path: string): UploadLocation {
  const slash = path.lastIndexOf('/');
  return slash === -1
    ? { directory: '', name: path }
    : { directory: path.slice(0, slash), name: path.slice(slash + 1) };
}

/**
 * Picks a name not in `taken`, suffixing the stem and keeping the extension.
 * The extension splits exactly as `slugifyFileName` splits it, so `sunset.jpg` becomes `sunset-2.jpg`.
 *
 * @example
 * ```ts
 * uniqueUploadName('sunset.jpg', ['sunset.jpg'])                 // -> 'sunset-2.jpg'
 * uniqueUploadName('sunset.jpg', ['sunset.jpg', 'sunset-2.jpg']) // -> 'sunset-3.jpg'
 * uniqueUploadName('notes', ['notes'])                           // -> 'notes-2'
 * ```
 */
export function uniqueUploadName(name: string, taken: readonly string[]): string {
  const { stem, extension } = splitExtension(name);
  const stems = taken
    .filter((candidate) => candidate.endsWith(extension))
    .map((candidate) => candidate.slice(0, candidate.length - extension.length));
  return uniqueName(stem, stems) + extension;
}

/**
 * Every folder path a directory implies, shallowest first, each one a row that must exist.
 *
 * @example
 * ```ts
 * ancestorDirectories('a/b/c') // -> ['a', 'a/b', 'a/b/c']
 * ancestorDirectories('')      // -> []
 * ```
 */
export function ancestorDirectories(directory: string): string[] {
  if (directory === '') return [];
  const segments = directory.split('/');
  return segments.map((_, index) => segments.slice(0, index + 1).join('/'));
}

/**
 * Splits a name into its stem and its dotted extension, `''` when the tail is not an extension.
 */
function splitExtension(name: string): { stem: string; extension: string } {
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || !EXTENSION.test(name.slice(dot + 1))) return { stem: name, extension: '' };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}
