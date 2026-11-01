/**
 * A package specifier split into the package it names and the `exports` subpath within it.
 */
export interface PackageSpecifier {
  /**
   * The package name, scope included: `@acme/kit` for `@acme/kit/auth`.
   */
  name: string;

  /**
   * The `exports` subpath: `./auth` for `@acme/kit/auth`, or `.` for a bare name.
   */
  subpath: string;
}

/**
 * Splits a package specifier into its package name and `exports` subpath.
 *
 * A scoped name keeps its first two segments, a plain name its first.
 * Whatever follows becomes the subpath; a bare name yields `.`.
 *
 * @example
 * ```ts
 * parsePackageSpecifier('@acme/kit/auth') // -> { name: '@acme/kit', subpath: './auth' }
 * parsePackageSpecifier('ohnejs/uploads') // -> { name: 'ohnejs', subpath: './uploads' }
 * parsePackageSpecifier('@acme/blog')     // -> { name: '@acme/blog', subpath: '.' }
 * ```
 */
export function parsePackageSpecifier(specifier: string): PackageSpecifier {
  const segments = specifier.split('/');
  const count = specifier.startsWith('@') ? 2 : 1;
  const name = segments.slice(0, count).join('/');
  const rest = segments.slice(count).join('/');
  return { name, subpath: rest ? `./${rest}` : '.' };
}
