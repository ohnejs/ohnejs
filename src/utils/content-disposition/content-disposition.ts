/**
 * Options accepted by `contentDisposition`.
 */
export interface ContentDispositionOptions {
  /**
   * Asks the browser to display the file in place instead of downloading it, as `inline`.
   *
   * @default
   * false
   */
  inline?: boolean;
}

const CONTROL = /\p{Cc}/gu;
const NON_ASCII = /\P{ASCII}/gu;
const QUOTE_OR_BACKSLASH = /["\\]/g;
const ATTR_CHAR = /[A-Za-z0-9!#$&+\-.^_`|~]/;

/**
 * Builds a `Content-Disposition` header value for `filename`, per RFC 6266.
 * The disposition is `attachment`, or `inline` with `inline: true`.
 *
 * `filename` is an ASCII fallback: control characters are dropped and other non-ASCII becomes `?`.
 * Quotes and backslashes are escaped, so the name cannot break out of the quoted string.
 * A name that is not plain ASCII also gets `filename*`, UTF-8 percent-encoded per RFC 8187.
 * A lone surrogate has no UTF-8 form and is encoded as the replacement character, `%EF%BF%BD`.
 * Browsers that understand `filename*` prefer it and show the original name.
 *
 * @example
 * ```ts
 * contentDisposition('report.pdf')
 * // -> 'attachment; filename="report.pdf"'
 *
 * contentDisposition('report.pdf', { inline: true })
 * // -> 'inline; filename="report.pdf"'
 *
 * contentDisposition('Übersicht.pdf')
 * // -> 'attachment; filename="?bersicht.pdf"; filename*=UTF-8\'\'%C3%9Cbersicht.pdf'
 * ```
 */
export function contentDisposition(filename: string, options?: ContentDispositionOptions): string {
  const type = options?.inline ? 'inline' : 'attachment';
  const name = filename.replace(CONTROL, '');
  const ascii = name.replace(NON_ASCII, '?');
  const header = `${type}; filename="${ascii.replace(QUOTE_OR_BACKSLASH, '\\$&')}"`;
  if (ascii === name) return header;

  const extended = Array.from(new TextEncoder().encode(name), (byte) => {
    const char = String.fromCharCode(byte);
    return ATTR_CHAR.test(char) ? char : `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }).join('');
  return `${header}; filename*=UTF-8''${extended}`;
}
