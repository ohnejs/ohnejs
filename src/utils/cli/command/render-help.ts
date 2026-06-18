import type { ArgSchema } from '../args/define-args.ts';
import type { Command } from './define-command.ts';

import { toArray } from '../../array/to-array.ts';
import { toKebabCase } from '../../case/to-kebab-case.ts';
import { isUndefined } from '../../is/is-undefined.ts';

/**
 * Renders the help text for a command as a plain string, ending with a newline.
 * Includes the title, description, a usage line, the subcommand list, and the option list.
 * Long flags are shown in kebab-case; `--help` (and `--version` when set) are appended automatically.
 *
 * @example
 * ```ts
 * renderHelp({ meta: { name: 'app' } })
 * // -> 'app\n\nUSAGE\n  app [options]\n\nOPTIONS\n  --help, -h  Show help\n'
 * ```
 */
export function renderHelp(command: Command): string {
  const { meta, args, subCommands } = command;
  const lines: string[] = [meta.version ? `${meta.name} ${meta.version}` : meta.name];

  if (meta.description) lines.push('', meta.description);

  lines.push('', 'USAGE', `  ${meta.name} ${subCommands ? '<command> ' : ''}[options]`);

  if (subCommands) {
    const rows = Object.entries(subCommands).map(([name, sub]): [string, string] => [
      name,
      sub.meta.description ?? '',
    ]);
    lines.push('', 'COMMANDS', ...renderRows(rows));
  }

  lines.push('', 'OPTIONS', ...renderRows(optionRows(command, args)));

  return lines.join('\n') + '\n';
}

function optionRows(command: Command, args: Command['args']): [string, string][] {
  const rows: [string, string][] = [];
  for (const name of Object.keys(args ?? {}))
    rows.push([optionLabel(name, args![name]!), optionDesc(args![name]!)]);
  if (command.meta.version) rows.push(['--version, -v', 'Show version']);
  rows.push(['--help, -h', 'Show help']);
  return rows;
}

function optionLabel(name: string, def: ArgSchema): string {
  const flags = [`--${toKebabCase(name)}`];
  for (const alias of toArray(def.alias ?? []))
    flags.push(alias.length === 1 ? `-${alias}` : `--${alias}`);
  if (def.type === 'boolean') return flags.join(', ');
  const placeholder = def.type === 'enum' ? def.options.join('|') : def.type;
  return `${flags.join(', ')} <${placeholder}>`;
}

function optionDesc(def: ArgSchema): string {
  const parts: string[] = [];
  if (def.description) parts.push(def.description);
  if (def.type !== 'boolean' && def.required) parts.push('(required)');
  else if (!isUndefined(def.default)) parts.push(`(default: ${def.default})`);
  return parts.join(' ');
}

function renderRows(rows: [string, string][]): string[] {
  const width = Math.max(0, ...rows.map(([label]) => label.length));
  return rows.map(([label, desc]) => (desc ? `  ${label.padEnd(width)}  ${desc}` : `  ${label}`));
}
