import type { ArgsSchema } from '../args/define-args.ts';
import type { Command } from './define-command.ts';

import { isColorStream } from '../../ansi/is-color-stream.ts';
import { pickANSIColors } from '../../ansi/pick-ansi-colors.ts';
import { didYouMean } from '../../did-you-mean/did-you-mean.ts';
import { isUndefined } from '../../is/is-undefined.ts';
import { hasKey } from '../../object/has-key.ts';
import { parseArgv } from '../args/parse-argv.ts';
import { resolveArgs } from '../args/resolve-args.ts';
import { renderHelp } from './render-help.ts';

/**
 * Options for `runCommand`.
 * The streams default to the matching `process` stream.
 */
export interface RunOptions {
  /**
   * `true` always emits ANSI; `false` strips.
   * Leave unset to fall back to the stream's `isTTY`.
   */
  color?: boolean | undefined;

  /**
   * Where help and version output is written.
   *
   * @default
   * process.stdout
   */
  stdout?: { write(text: string): void; isTTY?: boolean };

  /**
   * Where argument and command errors are written.
   *
   * @default
   * process.stderr
   */
  stderr?: { write(text: string): void };

  /**
   * Extra flags recognized at every command level, on top of each command's own args.
   * They are accepted rather than reported as unknown, but never resolved into a command's `values`.
   * A caller-side pre-pass owns their meaning.
   * Listed under `GLOBAL OPTIONS` in the root command's help.
   */
  globals?: ArgsSchema;
}

/**
 * Runs a command against an argv slice and returns the process exit code.
 * Dispatches to a subcommand by the first positional, then handles `--help`, `--version`, or runs.
 * Argument errors and unknown commands print to `stderr` and return `1`.
 * This never calls `process.exit`; the caller decides what to do with the code.
 *
 * @example
 * ```ts
 * const code = await runCommand(cli, process.argv.slice(2))
 * process.exit(code)
 * ```
 */
export async function runCommand(
  command: Command,
  argv: string[],
  options: RunOptions = {},
): Promise<number> {
  return dispatch(command, argv, options, [command.meta.name]);
}

/**
 * Recursive body of `runCommand`.
 * `path` holds the words that invoke `command`, so its usage line and hint are runnable.
 * Only the entry command, whose `path` is its name alone, lists `GLOBAL OPTIONS` in its help.
 * `options.globals` is recognized (never reported as unknown) at every level.
 */
async function dispatch(
  command: Command,
  argv: string[],
  options: RunOptions,
  path: string[],
): Promise<number> {
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const colors = pickANSIColors(options.color ?? isColorStream(stdout));
  const globals = path.length === 1 ? options.globals : undefined;
  const usage = path.join(' ');
  const sub = command.subCommands;
  const first = argv[0];
  const isCommandToken = !isUndefined(first) && !first.startsWith('-');

  if (sub && isCommandToken && hasKey(sub, first)) {
    return dispatch(sub[first]!, argv.slice(1), options, [...path, first]);
  }

  const peek = parseArgv(argv, { booleans: ['help', 'h', 'version', 'v'] });
  if (peek.flags.help || peek.flags.h) {
    stdout.write(renderHelp(command, colors, globals, usage));
    return 0;
  }
  if (command.meta.version && (peek.flags.version || peek.flags.v)) {
    stdout.write(`${command.meta.version}\n`);
    return 0;
  }

  if (sub && isCommandToken && !command.run) {
    const hint = didYouMean(first, Object.keys(sub));
    stderr.write(`Unknown command \`${first}\`${hint ? `. Did you mean \`${hint}\`?` : ''}\n`);
    return 1;
  }

  const flagsFirst = sub && !command.run && first?.startsWith('-');
  if (flagsFirst && resolveArgs({}, argv, options.globals).positionals.length > 0) {
    stderr.write(`Missing command before \`${first}\`\n`);
    return 1;
  }

  if (!command.run) {
    stdout.write(renderHelp(command, colors, globals, usage));
    return 0;
  }

  const schema: ArgsSchema = command.args ?? {};
  const resolved = resolveArgs(schema, argv, options.globals);
  if (!resolved.ok) {
    for (const error of resolved.errors) stderr.write(`${error.message}\n`);
    stderr.write(`\nRun \`${usage} --help\` for usage.\n`);
    return 1;
  }

  await command.run({ values: resolved.values, positionals: resolved.positionals });
  return 0;
}
