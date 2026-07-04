import { clamp } from '../number/clamp.ts';
import { MessageFormatError } from './message-errors.ts';

/**
 * Parses an ICU CLDR date/time skeleton (without `::`) into `Intl.DateTimeFormatOptions`.
 *
 * Each contiguous run of the same letter maps to one Intl option.
 * The letter count selects the variant: `MMM` -> `month: 'short'`, `MMMM` -> `month: 'long'`.
 *
 * Quoted spans (`'literal'`) and non-letter chars between symbols are skipped.
 * The locale dictates output order, so surrounding punctuation is advisory.
 *
 * Symbols without an `Intl.DateTimeFormat` equivalent throw `MessageFormatError`.
 * Rejected: quarter (`Q`, `q`), day-of-year (`D`), week-of-year (`w`), Julian day (`g`), and others.
 *
 * @example
 * ```ts
 * dateOptionsFromSkeleton('yMMMd')
 * // -> { year: 'numeric', month: 'short', day: 'numeric' }
 *
 * dateOptionsFromSkeleton('HH:mm')
 * // -> { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }
 * ```
 */
export function dateOptionsFromSkeleton(skeleton: string): Intl.DateTimeFormatOptions {
  const options: Intl.DateTimeFormatOptions = {};
  let i = 0;

  while (i < skeleton.length) {
    const ch = skeleton[i]!;

    if (ch === "'") {
      i++;
      if (skeleton[i] === "'") {
        i++;
        continue;
      }
      while (i < skeleton.length && skeleton[i] !== "'") i++;
      if (i < skeleton.length) i++;
      continue;
    }

    if (!isPatternLetter(ch)) {
      i++;
      continue;
    }

    let count = 1;
    while (i + count < skeleton.length && skeleton[i + count] === ch) count++;

    applySymbol(ch, count, options);
    i += count;
  }

  return options;
}

function isPatternLetter(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

function applySymbol(symbol: string, count: number, options: Intl.DateTimeFormatOptions): void {
  switch (symbol) {
    case 'G':
      options.era = count >= 5 ? 'narrow' : count === 4 ? 'long' : 'short';
      return;

    case 'y':
    case 'u':
    case 'U':
    case 'r':
      options.year = count === 2 ? '2-digit' : 'numeric';
      return;

    case 'M':
    case 'L':
      options.month =
        count === 1
          ? 'numeric'
          : count === 2
            ? '2-digit'
            : count === 3
              ? 'short'
              : count === 4
                ? 'long'
                : 'narrow';
      return;

    case 'd':
      options.day = count === 2 ? '2-digit' : 'numeric';
      return;

    case 'E':
    case 'e':
    case 'c':
      options.weekday = count === 4 ? 'long' : count === 5 ? 'narrow' : 'short';
      return;

    case 'h':
      options.hour = count === 2 ? '2-digit' : 'numeric';
      options.hourCycle = 'h12';
      return;

    case 'H':
      options.hour = count === 2 ? '2-digit' : 'numeric';
      options.hourCycle = 'h23';
      return;

    case 'k':
      options.hour = count === 2 ? '2-digit' : 'numeric';
      options.hourCycle = 'h24';
      return;

    case 'K':
      options.hour = count === 2 ? '2-digit' : 'numeric';
      options.hourCycle = 'h11';
      return;

    case 'j':
    case 'C':
      options.hour = count === 2 ? '2-digit' : 'numeric';
      return;

    case 'm':
      options.minute = count === 2 ? '2-digit' : 'numeric';
      return;

    case 's':
      options.second = count === 2 ? '2-digit' : 'numeric';
      return;

    case 'S':
      options.fractionalSecondDigits = clamp(count, 1, 3) as 1 | 2 | 3;
      return;

    case 'a':
      options.hourCycle ??= 'h12';
      return;

    case 'b':
    case 'B':
      options.dayPeriod = count === 4 ? 'long' : count === 5 ? 'narrow' : 'short';
      return;

    case 'z':
      options.timeZoneName = count === 4 ? 'long' : 'short';
      return;

    case 'Z':
      options.timeZoneName = count === 5 ? 'longOffset' : count === 4 ? 'long' : 'shortOffset';
      return;

    case 'O':
      options.timeZoneName = count === 4 ? 'longOffset' : 'shortOffset';
      return;

    case 'v':
    case 'V':
      options.timeZoneName = count >= 4 ? 'longGeneric' : 'shortGeneric';
      return;

    case 'X':
    case 'x':
      options.timeZoneName = count === 1 ? 'shortOffset' : 'longOffset';
      return;

    case 'Q':
    case 'q':
    case 'w':
    case 'W':
    case 'D':
    case 'F':
    case 'g':
    case 'A':
    case 'n':
    case 'N':
    case 'Y':
      throw new MessageFormatError(
        `date skeleton symbol \`${symbol}\` has no Intl.DateTimeFormat equivalent`,
      );

    default:
      throw new MessageFormatError(`unknown date skeleton symbol \`${symbol}\``);
  }
}
