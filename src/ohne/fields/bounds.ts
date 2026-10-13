import { isRealNumber, isUndefined } from '../../utils/index.ts';

/**
 * How `boundsProblem` reads one pair of bound options.
 */
export interface BoundsRule {
  /**
   * The names of the lower and the upper bound option.
   *
   * @default
   * ['min', 'max']
   */
  names?: readonly [lower: string, upper: string];

  /**
   * Reads a declared bound into a form two bounds compare in, or `undefined` when it cannot.
   * Omitted takes a finite number as it is.
   */
  parse?: (bound: unknown) => number | string | undefined;

  /**
   * What a readable bound looks like, for the fix row of an unreadable one.
   *
   * @default
   * 'a number'
   */
  form?: string;
}

/**
 * One declared bound: its option name, its value, and what `parse` read from it.
 */
interface Bound {
  name: string;
  bound: unknown;
  read: number | string | undefined;
}

/**
 * Checks a pair of bound options, for a field type's `validateOptions`.
 * Returns the problem as error body rows, or `undefined` when the pair holds.
 * A bound the field cannot read would never take effect.
 * A lower bound above the upper one admits no value.
 * An absent bound is skipped, and equal bounds are legal.
 *
 * @example
 * ```ts
 * boundsProblem({ min: 1, max: 10 })
 * // -> undefined
 *
 * boundsProblem({ min: 10, max: 1 })
 * // -> ['`min` is `10`, above `max` `1`, so no value can pass.', 'Swap them, or lower `min`.']
 *
 * boundsProblem({ minWidth: 'wide' }, { names: ['minWidth', 'maxWidth'] })
 * // -> ['`minWidth` is `wide`, which the field cannot read.', 'Write it as a number.']
 * ```
 */
export function boundsProblem(options: object, rule: BoundsRule = {}): string[] | undefined {
  const { names = ['min', 'max'], parse = finite, form = 'a number' } = rule;
  const declared = (name: string): Bound => {
    const value = (options as Readonly<Record<string, unknown>>)[name];
    return { name, bound: value, read: isUndefined(value) ? undefined : parse(value) };
  };
  const lower = declared(names[0]);
  const upper = declared(names[1]);
  for (const { name, bound, read } of [lower, upper]) {
    if (!isUndefined(bound) && isUndefined(read)) {
      return [
        `\`${name}\` is \`${String(bound)}\`, which the field cannot read.`,
        `Write it as ${form}.`,
      ];
    }
  }
  if (isUndefined(lower.read) || isUndefined(upper.read) || lower.read <= upper.read)
    return undefined;
  return [
    `\`${lower.name}\` is \`${String(lower.bound)}\`, above \`${upper.name}\` \`${String(upper.bound)}\`, so no value can pass.`,
    `Swap them, or lower \`${lower.name}\`.`,
  ];
}

/**
 * A bound as a finite number, or `undefined` when it is none.
 */
function finite(bound: unknown): number | undefined {
  return isRealNumber(bound) ? bound : undefined;
}
