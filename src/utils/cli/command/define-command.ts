import type { ArgsSchema, ResolvedArgs } from '../args/define-args.ts';

/**
 * Identifying metadata for a command.
 */
export interface CommandMeta {
  /**
   * The command name, shown in help and version output.
   */
  name: string;

  /**
   * Version string.
   * When set, the command accepts `--version`.
   */
  version?: string;

  /**
   * One-line summary, shown in help and in a parent's command list.
   */
  description?: string;
}

/**
 * The argument passed to a command's `run` handler.
 */
export interface CommandContext<S extends ArgsSchema> {
  /**
   * The resolved, typed option values for this command.
   */
  values: ResolvedArgs<S>;

  /**
   * Positional arguments left after flags are removed.
   */
  positionals: string[];
}

/**
 * A command: its metadata, argument schema, nested subcommands, and run handler.
 * A command with `subCommands` dispatches to them by the first positional; one with `run` does work.
 */
export interface Command<S extends ArgsSchema = ArgsSchema> {
  /**
   * Identifying metadata.
   */
  meta: CommandMeta;

  /**
   * The argument schema, defined with `defineArgs` or inline.
   */
  args?: S;

  /**
   * Nested subcommands keyed by the name used to invoke them.
   */
  subCommands?: Record<string, Command>;

  /**
   * Handler invoked with the resolved context when this command runs.
   */
  run?(context: CommandContext<S>): void | Promise<void>;
}

/**
 * Identity helper that captures a `Command` with its argument types intact.
 * Use it so the `run` handler sees fully typed `values` inferred from `args`.
 *
 * @example
 * ```ts
 * const build = defineCommand({
 *   meta: { name: 'build' },
 *   args: { out: { type: 'string', default: 'dist' } },
 *   run({ values }) {
 *     values.out // -> string
 *   },
 * })
 * ```
 */
export function defineCommand<const S extends ArgsSchema = {}>(command: Command<S>): Command<S> {
  return command;
}
