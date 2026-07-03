import { isArray } from '../../is/is-array.ts';
import { isUndefined } from '../../is/is-undefined.ts';

/**
 * A single parsed flag value.
 * A repeated flag collects its values into an array in occurrence order.
 */
export type FlagValue = string | boolean | Array<string | boolean>;

/**
 * Options for `parseArgv`.
 */
export interface ParseArgvOptions {
  /**
   * Long flag names (without the `--`) that never take a value.
   * A boolean flag does not consume the token after it, so `--force build` keeps `build` positional.
   * Without this hint, a bare flag followed by a non-flag token consumes that token as its value.
   *
   * @default
   * []
   */
  booleans?: Iterable<string> | undefined;
}

/**
 * Raw, syntactic split of an argv slice into positionals and flags.
 * No schema, coercion, aliases, or defaults are applied - that is the resolver's job.
 */
export interface ParsedArgv {
  /**
   * Positional arguments, in order.
   * Every token after a bare `--` terminator is included verbatim.
   */
  positionals: string[];

  /**
   * Flags keyed by name: long flags without the `--`, short flags as the single character.
   * The object has a `null` prototype, so flag names like `__proto__` are stored safely.
   */
  flags: Record<string, FlagValue>;
}

/**
 * Splits an argv slice into positionals and flags without consulting a schema.
 *
 * Recognized forms:
 * - `--name value` and `--name=value` set a string value.
 * - `--name` alone sets `true`; `--no-name` sets `false`.
 * - `-abc` expands to three boolean flags; `-p 3000`, `-p=3000`, and `-p3000` set a value.
 * - A repeated flag collects its values into an array.
 * - `--` ends flag parsing; the rest is positional. A lone `-` and negative numbers stay positional.
 *
 * A bare flag consumes the following token as its value.
 * It does not consume when the flag is listed in `booleans` or the next token is itself a flag.
 * A `--no-*` flag whose full name is listed in `booleans` is taken verbatim instead of negating.
 *
 * @example
 * ```ts
 * parseArgv(['build', '--prod'])
 * // -> { positionals: ['build'], flags: { prod: true } }
 *
 * parseArgv(['--name', 'app', '--no-cache'])
 * // -> { positionals: [], flags: { name: 'app', cache: false } }
 *
 * parseArgv(['-abc', '-p', '3000'])
 * // -> { positionals: [], flags: { a: true, b: true, c: true, p: '3000' } }
 *
 * parseArgv(['--force', 'build'], { booleans: ['force'] })
 * // -> { positionals: ['build'], flags: { force: true } }
 *
 * parseArgv(['--', '--raw'])
 * // -> { positionals: ['--raw'], flags: {} }
 * ```
 */
export function parseArgv(argv: string[], options: ParseArgvOptions = {}): ParsedArgv {
  const booleans = new Set(options.booleans);
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = Object.create(null);

  const assign = (name: string, value: string | boolean): void => {
    const existing = flags[name];
    if (isUndefined(existing)) flags[name] = value;
    else if (isArray<Array<string | boolean>>(existing)) existing.push(value);
    else flags[name] = [existing, value];
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (token === '--') {
      for (let j = i + 1; j < argv.length; j++) positionals.push(argv[j]!);
      break;
    }

    if (token.startsWith('--')) {
      const body = token.slice(2);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        assign(body.slice(0, eq), body.slice(eq + 1));
      } else if (body.startsWith('no-') && !booleans.has(body)) {
        assign(body.slice(3), false);
      } else if (consumesNext(body, argv[i + 1], booleans)) {
        assign(body, argv[++i]!);
      } else {
        assign(body, true);
      }
      continue;
    }

    if (isShortFlag(token)) {
      const body = token.slice(1);
      const eq = body.indexOf('=');
      if (eq !== -1) {
        expandShort(body.slice(0, eq - 1), assign);
        assign(body[eq - 1]!, body.slice(eq + 1));
      } else {
        const attached = body.search(/\d/);
        if (attached > 0) {
          expandShort(body.slice(0, attached - 1), assign);
          assign(body[attached - 1]!, body.slice(attached));
        } else {
          const last = body.at(-1)!;
          expandShort(body.slice(0, -1), assign);
          if (consumesNext(last, argv[i + 1], booleans)) assign(last, argv[++i]!);
          else assign(last, true);
        }
      }
      continue;
    }

    positionals.push(token);
  }

  return { positionals, flags };
}

function consumesNext(name: string, next: string | undefined, booleans: Set<string>): boolean {
  return !booleans.has(name) && !isUndefined(next) && !isFlag(next);
}

function expandShort(chars: string, assign: (name: string, value: boolean) => void): void {
  for (const char of chars) assign(char, true);
}

function isFlag(token: string): boolean {
  return token.length > 1 && token[0] === '-' && !isNegativeNumber(token);
}

function isShortFlag(token: string): boolean {
  return token[0] === '-' && token.length > 1 && token[1] !== '-' && !isNegativeNumber(token);
}

function isNegativeNumber(token: string): boolean {
  return /^-\d/.test(token);
}
