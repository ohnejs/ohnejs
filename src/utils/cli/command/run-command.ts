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
   * When set, overrides TTY auto-detection.
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
  const stdout = options.stdout ?? process.stdout;
  const stderr = options.stderr ?? process.stderr;
  const colors = pickANSIColors(options.color ?? isColorStream(stdout));
  const sub = command.subCommands;
  const first = argv[0];
  const isCommandToken = !isUndefined(first) && !first.startsWith('-');

  if (sub && isCommandToken && hasKey(sub, first)) {
    return runCommand(sub[first]!, argv.slice(1), options);
  }

  const peek = parseArgv(argv, { booleans: ['help', 'h', 'version', 'v'] });
  if (peek.flags.help || peek.flags.h) {
    stdout.write(renderHelp(command, colors));
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

  if (!command.run) {
    stdout.write(renderHelp(command, colors));
    return 0;
  }

  const schema: ArgsSchema = command.args ?? {};
  const resolved = resolveArgs(schema, argv);
  if (!resolved.ok) {
    for (const error of resolved.errors) stderr.write(`${error.message}\n`);
    stderr.write(`\nRun \`${command.meta.name} --help\` for usage.\n`);
    return 1;
  }

  await command.run({ values: resolved.values, positionals: resolved.positionals });
  return 0;
}
