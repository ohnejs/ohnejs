import { last } from '../array/last.ts';
import { lowercase } from '../case/lowercase.ts';
import { isString } from './is-string.ts';

const LABEL = /^[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]{0,61}[\p{L}\p{M}\p{N}])?$/u;
const NUMERIC = /^(?:\d+|0x[\da-f]*)$/i;
const IGNORABLE = /\p{DI}/u;
const UNFOLDED = /(?![ßς])\p{CWCF}/u;

/**
 * Checks whether a value is a public domain name: two or more dot-separated labels, 253 characters at most.
 * A label is 1-63 letters, marks, digits and `-`, starting with a letter or digit and not ending with `-`.
 * Unicode and `xn--` labels are taken as typed.
 *
 * A name a browser would silently rewrite is refused, so `lowercase` stores the very name a browser resolves.
 * That covers compatibility characters such as `ｅｘａｍｐｌｅ`, invisible ones such as U+034F, and a numeric TLD.
 * It also covers the few letters IDNA case-folds past their lowercase, such as Cherokee and `ᾳ`.
 *
 * @example
 * ```ts
 * isDomainName('dalaran.example') // -> true
 * isDomainName('münchen.de')      // -> true
 * isDomainName('-x.y')            // -> false
 * isDomainName('x_y.z')           // -> false
 * isDomainName('0x7f.0x1')        // -> false
 * isDomainName('localhost')       // -> false
 * ```
 */
export function isDomainName(value: unknown): value is string {
  if (!isString(value) || value.length > 253) return false;
  const labels = value.split('.');
  if (labels.length < 2 || NUMERIC.test(last(labels)!)) return false;
  return labels.every(
    (label) =>
      LABEL.test(label) &&
      label.normalize('NFKC') === label.normalize('NFC') &&
      !IGNORABLE.test(label) &&
      !UNFOLDED.test(lowercase(label)),
  );
}
