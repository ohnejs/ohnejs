import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';
import type { ArgSchema, ArgsSchema } from '../args/define-args.ts';
import type { Command } from './define-command.ts';

import { toArray } from '../../array/to-array.ts';
import { toKebabCase } from '../../case/to-kebab-case.ts';
import { isUndefined } from '../../is/is-undefined.ts';

interface Row {
  label: string;
  styled: string;
  desc: string;
}

/**
 * Renders the help text for a command as a string, ending with a newline.
 * Includes the title, description, a usage line, the subcommand list, and the option list.
 * Long flags are shown in kebab-case; `--help` (and `--version` when set) are appended automatically.
 * A `globals` schema, when passed, is rendered under a `GLOBAL OPTIONS` section after the options.
 * The `colors` styler set tints the output; pass the plain set to emit no codes.
 *
 * @example
 * ```ts
 * renderHelp({ meta: { name: 'app' } }, pickANSIColors(false))
 * // -> 'app\n\nUSAGE\n  app [options]\n\nOPTIONS\n  --help, -h  Show help\n'
 * ```
 */
export function renderHelp(command: Command, colors: ANSIColors, globals?: ArgsSchema): string {
  const { meta, args, subCommands } = command;
  const title = meta.version
    ? `${colors.bold(meta.name)} ${colors.dim(meta.version)}`
    : colors.bold(meta.name);
  const lines: string[] = [title];

  if (meta.description) lines.push('', meta.description);

  lines.push(
    '',
    colors.bold('USAGE'),
    `  ${meta.name} ${subCommands ? '<command> ' : ''}[options]`,
  );

  if (subCommands) {
    const rows = Object.entries(subCommands).map(
      ([name, sub]): Row => ({
        label: name,
        styled: colors.cyan(name),
        desc: sub.meta.description ?? '',
      }),
    );
    lines.push('', colors.bold('COMMANDS'), ...renderRows(rows));
  }

  lines.push('', colors.bold('OPTIONS'), ...renderRows(optionRows(command, args, colors)));

  const globalRows = globals ? schemaRows(globals, colors) : [];
  if (globalRows.length > 0) {
    lines.push('', colors.bold('GLOBAL OPTIONS'), ...renderRows(globalRows));
  }

  return lines.join('\n') + '\n';
}

function schemaRows(args: ArgsSchema | undefined, colors: ANSIColors): Row[] {
  const rows: Row[] = [];
  for (const name of Object.keys(args ?? {})) {
    const def = args![name]!;
    if (def.hidden) continue;
    rows.push(optionRow(name, def, colors));
  }
  return rows;
}

function optionRows(command: Command, args: Command['args'], colors: ANSIColors): Row[] {
  const rows = schemaRows(args, colors);
  if (command.meta.version)
    rows.push({
      label: '--version, -v',
      styled: colors.cyan('--version, -v'),
      desc: 'Show version',
    });
  rows.push({ label: '--help, -h', styled: colors.cyan('--help, -h'), desc: 'Show help' });
  return rows;
}

function optionRow(name: string, def: ArgSchema, colors: ANSIColors): Row {
  const flags = [`--${toKebabCase(name)}`];
  for (const alias of toArray(def.alias ?? []))
    flags.push(alias.length === 1 ? `-${alias}` : `--${alias}`);
  const joined = flags.join(', ');
  const desc = optionDesc(def);
  if (def.type === 'boolean') return { label: joined, styled: colors.cyan(joined), desc };
  const placeholder = `<${def.type === 'enum' ? def.options.join('|') : def.type}>`;
  return {
    label: `${joined} ${placeholder}`,
    styled: `${colors.cyan(joined)} ${colors.dim(placeholder)}`,
    desc,
  };
}

function optionDesc(def: ArgSchema): string {
  const parts: string[] = [];
  if (def.description) parts.push(def.description);
  if (def.type !== 'boolean' && def.required) parts.push('(required)');
  else if (!isUndefined(def.default)) parts.push(`(default: ${def.default})`);
  return parts.join(' ');
}

function renderRows(rows: Row[]): string[] {
  const width = Math.max(0, ...rows.map(({ label }) => label.length));
  return rows.map(({ label, styled, desc }) =>
    desc ? `  ${styled}${' '.repeat(width - label.length)}  ${desc}` : `  ${styled}`,
  );
}
