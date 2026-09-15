/**
 * Compiled glob matcher produced by `compileGlob`.
 * Call it with a string to test it against the pattern.
 *
 * @example
 * ```ts
 * const matcher = compileGlob('/admin/**')
 *
 * matcher('/admin/users') // -> true
 * matcher('/admin')       // -> false
 *
 * matcher.source          // -> '/admin/**'
 * ```
 */
export interface GlobMatcher {
  /**
   * Tests `input` against the compiled glob.
   * Matches the whole string, not a substring.
   */
  (input: string): boolean;

  /**
   * The source glob this matcher was built from.
   */
  readonly source: string;

  /**
   * The compiled regular expression.
   * Exposed for diagnostics.
   */
  readonly regex: RegExp;
}

const META_RE = /[.+^${}()|[\]\\]/;

/**
 * Compiles a glob pattern into a fast, reusable matcher.
 *
 * Supported syntax:
 * - `*` matches any run of characters except `/`.
 * - `**` matches any run of characters including `/`.
 * - `?` matches a single character except `/`.
 *
 * Every other character is matched literally.
 * The match is anchored to the whole input, so the pattern must cover it end to end.
 * Compile once and reuse the matcher; the regex is cached on it.
 *
 * @example
 * ```ts
 * compileGlob('*.ts')('index.ts')         // -> true
 * compileGlob('*.ts')('nested/index.ts')  // -> false
 * compileGlob('**\/*.ts')('nested/a.ts')  // -> true
 * compileGlob('/authors/?')('/authors/1') // -> true
 * compileGlob('/admin/**')('/admin/x/y')  // -> true
 * ```
 */
export function compileGlob(glob: string): GlobMatcher {
  let src = '^';
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i];
    if (char === '*') {
      if (glob[i + 1] === '*') {
        src += '[^]*';
        i++;
      } else {
        src += '[^/]*';
      }
    } else if (char === '?') {
      src += '[^/]';
    } else {
      src += META_RE.test(char) ? `\\${char}` : char;
    }
  }
  src += '$';

  const regex = new RegExp(src);

  /**
   * Tests the whole of `input` against the anchored `regex`.
   */
  function match(input: string): boolean {
    return regex.test(input);
  }

  return Object.assign(match, { source: glob, regex }) as GlobMatcher;
}
