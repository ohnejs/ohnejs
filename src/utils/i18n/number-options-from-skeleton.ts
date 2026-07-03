import { isNull } from '../is/is-null.ts';
import { MessageFormatError } from './message-errors.ts';

const ROUNDING_INCREMENTS: ReadonlySet<number> = new Set([
  1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000,
]);

/**
 * Parses an ICU number skeleton (without the leading `::`) into `Intl.NumberFormatOptions`.
 *
 * Covers the full skeleton grammar.
 * Fraction shortcuts: `.00`, `.0##`, `.00*`.
 * Significant shortcuts: `@@@`, `@@##`, `@*`.
 *
 * Stems without an `Intl.NumberFormat` equivalent throw `MessageFormatError` with the offending token.
 * Notable rejections: `permille`, `scale/N`, `precision-currency-cash`, `decimal-always`, `group-thousands`.
 *
 * @example
 * ```ts
 * numberOptionsFromSkeleton('currency/EUR .00')
 * // -> { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }
 *
 * numberOptionsFromSkeleton('percent group-off sign-always')
 * // -> { style: 'percent', useGrouping: false, signDisplay: 'always' }
 * ```
 */
export function numberOptionsFromSkeleton(skeleton: string): Intl.NumberFormatOptions {
  const options: Intl.NumberFormatOptions = {};
  const tokens = skeleton.trim().split(/\s+/).filter(Boolean);
  for (const token of tokens) applyToken(token, options);
  return options;
}

function applyToken(token: string, options: Intl.NumberFormatOptions): void {
  if (token.startsWith('.')) {
    applyFractionShortcut(token, options);
    return;
  }
  if (token.startsWith('@')) {
    applySignificantShortcut(token, options);
    return;
  }

  const slash = token.indexOf('/');
  const stem = slash === -1 ? token : token.slice(0, slash);
  const arg = slash === -1 ? null : token.slice(slash + 1);

  if (!isNull(arg)) {
    applyParametricStem(stem, arg, token, options);
    return;
  }

  applyBareStem(stem, options);
}

function applyBareStem(stem: string, options: Intl.NumberFormatOptions): void {
  switch (stem) {
    case 'compact-short':
      options.notation = 'compact';
      options.compactDisplay = 'short';
      return;
    case 'compact-long':
      options.notation = 'compact';
      options.compactDisplay = 'long';
      return;
    case 'notation-simple':
      options.notation = 'standard';
      return;
    case 'scientific':
      options.notation = 'scientific';
      return;
    case 'engineering':
      options.notation = 'engineering';
      return;

    case 'percent':
      options.style = 'percent';
      return;
    case 'base-unit':
      options.style = 'decimal';
      return;

    case 'precision-integer':
      options.maximumFractionDigits = 0;
      return;
    case 'precision-unlimited':
      options.maximumFractionDigits = 20;
      return;
    case 'precision-currency-standard':
      return;

    case 'rounding-mode-ceiling':
      options.roundingMode = 'ceil';
      return;
    case 'rounding-mode-floor':
      options.roundingMode = 'floor';
      return;
    case 'rounding-mode-down':
      options.roundingMode = 'trunc';
      return;
    case 'rounding-mode-up':
      options.roundingMode = 'expand';
      return;
    case 'rounding-mode-half-even':
      options.roundingMode = 'halfEven';
      return;
    case 'rounding-mode-half-down':
      options.roundingMode = 'halfTrunc';
      return;
    case 'rounding-mode-half-up':
      options.roundingMode = 'halfExpand';
      return;

    case 'group-off':
      options.useGrouping = false;
      return;
    case 'group-min2':
      options.useGrouping = 'min2';
      return;
    case 'group-auto':
      options.useGrouping = 'auto';
      return;
    case 'group-on-aligned':
      options.useGrouping = 'always';
      return;

    case 'latin':
      options.numberingSystem = 'latn';
      return;

    case 'sign-auto':
      options.signDisplay = 'auto';
      return;
    case 'sign-always':
      options.signDisplay = 'always';
      return;
    case 'sign-never':
      options.signDisplay = 'never';
      return;
    case 'sign-except-zero':
      options.signDisplay = 'exceptZero';
      return;
    case 'sign-negative':
      options.signDisplay = 'negative';
      return;
    case 'sign-accounting':
      options.currencySign = 'accounting';
      return;
    case 'sign-accounting-always':
      options.currencySign = 'accounting';
      options.signDisplay = 'always';
      return;
    case 'sign-accounting-except-zero':
      options.currencySign = 'accounting';
      options.signDisplay = 'exceptZero';
      return;
    case 'sign-accounting-negative':
      options.currencySign = 'accounting';
      options.signDisplay = 'negative';
      return;

    case 'decimal-auto':
      return;

    case 'unit-width-narrow':
      stashUnitWidth('narrow', options);
      return;
    case 'unit-width-short':
      stashUnitWidth('short', options);
      return;
    case 'unit-width-full-name':
      stashUnitWidth('long', options);
      return;
    case 'unit-width-iso-code':
      options.currencyDisplay = 'code';
      return;

    case 'permille':
      throw unsupported('permille', 'no Intl.NumberFormat equivalent');
    case 'precision-currency-cash':
      throw unsupported(stem, 'no Intl.NumberFormat equivalent');
    case 'group-thousands':
      throw unsupported(stem, 'no Intl.NumberFormat equivalent');
    case 'decimal-always':
      throw unsupported(stem, 'no Intl.NumberFormat equivalent');
    case 'rounding-mode-unnecessary':
      throw unsupported(stem, 'no Intl.NumberFormat equivalent');
    case 'unit-width-hidden':
    case 'unit-width-formal':
    case 'unit-width-variant':
      throw unsupported(stem, 'no Intl.NumberFormat equivalent');

    default:
      throw new MessageFormatError(`unknown number skeleton stem \`${stem}\``);
  }
}

function applyParametricStem(
  stem: string,
  arg: string,
  raw: string,
  options: Intl.NumberFormatOptions,
): void {
  switch (stem) {
    case 'currency':
      options.style = 'currency';
      options.currency = arg;
      return;

    case 'unit':
    case 'concise-unit': {
      options.style = 'unit';
      options.unit = arg;
      return;
    }

    case 'measure-unit': {
      options.style = 'unit';
      options.unit = stripUnitPrefix(arg);
      return;
    }

    case 'numbering-system':
      options.numberingSystem = arg;
      return;

    case 'integer-width': {
      const min = parseIntegerWidth(arg);
      if (min > 0) options.minimumIntegerDigits = min;
      return;
    }

    case 'precision-increment': {
      const { increment, minMax } = parseIncrement(arg);
      if (!ROUNDING_INCREMENTS.has(increment)) {
        throw new MessageFormatError(
          `precision-increment/${arg} yields ${increment}, which Intl.NumberFormat does not support (allowed: 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000)`,
        );
      }
      options.roundingIncrement = increment as Intl.NumberFormatOptions['roundingIncrement'];
      options.minimumFractionDigits = minMax;
      options.maximumFractionDigits = minMax;
      return;
    }

    case 'scale':
      throw unsupported(raw, 'value transformation is not supported');
    case 'usage':
      throw unsupported(raw, 'no Intl.NumberFormat equivalent');
    case 'per-measure-unit':
      throw unsupported(raw, 'no Intl.NumberFormat equivalent');

    default:
      throw new MessageFormatError(`unknown number skeleton stem \`${stem}/\``);
  }
}

function applyFractionShortcut(token: string, options: Intl.NumberFormatOptions): void {
  let i = 1;
  let min = 0;
  while (i < token.length && token[i] === '0') {
    min++;
    i++;
  }
  let max = min;
  while (i < token.length && token[i] === '#') {
    max++;
    i++;
  }
  const star = i < token.length && token[i] === '*';
  if (star) i++;
  if (i !== token.length) {
    throw new MessageFormatError(`malformed fraction skeleton \`${token}\``);
  }
  options.minimumFractionDigits = min;
  options.maximumFractionDigits = star ? 20 : max;
}

function applySignificantShortcut(token: string, options: Intl.NumberFormatOptions): void {
  let i = 0;
  let min = 0;
  while (i < token.length && token[i] === '@') {
    min++;
    i++;
  }
  let max = min;
  while (i < token.length && token[i] === '#') {
    max++;
    i++;
  }
  const star = i < token.length && token[i] === '*';
  if (star) i++;
  if (i !== token.length) {
    throw new MessageFormatError(`malformed significant skeleton \`${token}\``);
  }
  options.minimumSignificantDigits = min;
  options.maximumSignificantDigits = star ? 21 : max;
}

function parseIntegerWidth(arg: string): number {
  const body = arg.startsWith('*') || arg.startsWith('+') ? arg.slice(1) : arg;
  if (!/^0+$/.test(body)) {
    throw new MessageFormatError(`malformed integer-width pattern \`${arg}\``);
  }
  return body.length;
}

function parseIncrement(arg: string): { increment: number; minMax: number } {
  if (!/^\d+(?:\.\d+)?$/.test(arg)) {
    throw new MessageFormatError(`malformed precision-increment value \`${arg}\``);
  }
  const dot = arg.indexOf('.');
  const minMax = dot === -1 ? 0 : arg.length - dot - 1;
  const scaled = Math.round(Number(arg) * Math.pow(10, minMax));
  return { increment: scaled, minMax };
}

function stripUnitPrefix(name: string): string {
  const dash = name.indexOf('-');
  if (dash === -1) return name;
  return name.slice(dash + 1);
}

function stashUnitWidth(
  value: 'narrow' | 'short' | 'long',
  options: Intl.NumberFormatOptions,
): void {
  options.unitDisplay = value;
  if (value === 'narrow') options.currencyDisplay = 'narrowSymbol';
  else if (value === 'long') options.currencyDisplay = 'name';
  else options.currencyDisplay = 'symbol';
}

function unsupported(token: string, reason: string): MessageFormatError {
  return new MessageFormatError(`number skeleton \`${token}\` is not supported (${reason})`);
}
