import { codeSpan } from '../../utils/ansi/index.ts';
import { readFile } from '../../utils/fs/index.ts';
import { resolveImport, resolvePackageImport, stripFile } from '../../utils/imports/index.ts';
import {
  isArray,
  isEmpty,
  isNull,
  isUndefined,
  lineCount,
  relativePath,
} from '../../utils/index.ts';
import { isOhneError, ohneError } from '../error/ohne-error.ts';

/**
 * A module of a contract closure, ready to be copied into a namespace of the types file.
 */
export interface ContractModule {
  /**
   * The module's absolute path.
   */
  file: string;

  /**
   * The namespace that holds it: `Contract` for the app's entry, `L<n>` for another entry, else `M<n>`.
   */
  name: string;

  /**
   * Its text with every type import rewritten to an `import` alias, indented one level.
   * Empty when the module holds nothing but whitespace.
   */
  text: string;
}

/**
 * Options for `readContractModules`.
 */
export interface ReadContractModulesOptions {
  /**
   * The entry that is the app's own, whose namespace is `Contract`.
   */
  app?: string;
}

interface Rewrite {
  start: number;
  end: number;
  target: string;
  via: string;
  exports: string[];
  render: (namespace: string, exported: Set<string>) => string;
}

interface Parsed {
  source: string;
  rewrites: Rewrite[];
  literal: Set<number>;
  routes: boolean;
}

interface Scan {
  code: string;
  keywords: { word: string; at: number; top: boolean }[];
  literal: Set<number>;
}

const RUNTIME_NAME =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:const|let|var|function\*?|class)\s+([\w$]+)/;
const IMPORT_NAMED = /import\s+type\s*\{([^}]*)\}\s*from\s*(['"])([^'"]*)\2(?:\s*;)?/y;
const IMPORT_ALL = /import\s+type\s*\*\s*as\s+([\w$]+)\s+from\s*(['"])([^'"]*)\2(?:\s*;)?/y;
const IMPORT_DEFAULT = /import\s+type\s+[\w$]+/y;
const EXPORT_NAMED = /export\s+type\s*\{([^}]*)\}\s*from\s*(['"])([^'"]*)\2(?:\s*;)?/y;
const EXPORT_ALL = /export\s+type\s*\*\s*as\s+([\w$]+)\s+from\s*(['"])([^'"]*)\2(?:\s*;)?/y;
const EXPORT_STAR = /export\s+type\s*\*/y;
const EXPORT_LIST = /export\s+(?:type\s*)?\{/y;
const EXPORT_DEFAULT = /export\s+default\b/y;
const EXPORT_DECLARE = /export\s+declare\b/y;
const EXPORT_ROUTES = /export\s+(?:interface|type)\s+Routes\b/y;
const EXPORT_OTHER = /export\s+(?:import\b|=)/y;
const SPECIFIER = /^([\w$]+)(?:\s+as\s+([\w$]+))?$/;
const IMPORT_CALL = /import\s*\(\s*['"`]/y;
const IDENTIFIER = /[\w$]+/y;
const OPENERS = new Set(['{', '(', '[']);
const CLOSERS = new Set(['}', ')', ']']);

/**
 * Reads the contract closure of `entries`: each entry plus every module it reaches by type imports.
 *
 * Each module must hold only types, so it strips to comments and whitespace.
 * Its text is copied verbatim; only its type imports and re-exports become `import` aliases of other modules.
 * A relative specifier resolves like `resolveImport`, a package one like `resolvePackageImport`.
 *
 * A module refuses with a block at the exact offending position when it holds runtime code.
 * So does a top-level `declare`, a default import or export, or a local export list.
 * So do an `import()` type, an `export type *` without a name, and an import of anything but a `.ts` file.
 * An entry that exports no `Routes` refuses too.
 *
 * Returns the entries first, in their order, then the other modules in the order the walk reaches them.
 */
export async function readContractModules(
  entries: readonly string[],
  options: ReadContractModulesOptions = {},
): Promise<ContractModule[]> {
  const parsed = new Map<string, Parsed>();
  const order: string[] = [];
  for (const entry of entries) {
    await visit(entry);
    if (!parsed.get(entry)!.routes) {
      throw ohneError({
        title: `Contract ${codeSpan(shown(entry))} exports no \`Routes\``,
        body: ["A layer's `ohne.contract.ts` exports `interface Routes`, keyed by route id."],
        path: entry,
      });
    }
  }

  const names = new Map<string, string>();
  entries.forEach((entry, i) => names.set(entry, entry === options.app ? 'Contract' : `L${i}`));
  for (const file of order) if (!names.has(file)) names.set(file, `M${names.size}`);

  return [...names].map(([file, name]) => ({
    file,
    name,
    text: render(parsed.get(file)!, names),
  }));

  /**
   * Parses `file` once, then walks every module its type imports reach.
   */
  async function visit(file: string, via?: string): Promise<void> {
    if (parsed.has(file)) return;
    const module = await parseContract(file).catch((error: unknown) => {
      if (!isUndefined(via) && isOhneError(error) && isArray<string[]>(error.body)) {
        error.body = [...error.body, '', `It is imported at ${codeSpan(shown(via))}.`];
      }
      throw error;
    });
    parsed.set(file, module);
    order.push(file);
    for (const rewrite of module.rewrites) await visit(rewrite.target, rewrite.via);
  }
}

/**
 * Checks that `file` holds only types, then finds its type imports and resolves each.
 */
async function parseContract(file: string): Promise<Parsed> {
  const stripped = await strip(file);
  const source = (await readFile(file)) ?? '';
  const leftover = firstCode(stripped);
  if (leftover !== -1) refuseRuntime(file, source, stripped, leftover);

  const { code, keywords, literal } = scan(source);
  const rewrites: Rewrite[] = [];
  let routes = false;
  for (const { word, at, top } of keywords) {
    if (word === 'import' && matchAt(IMPORT_CALL, code, at)) {
      refuse(file, source, at, `uses an \`import()\` type`, [
        'The types file cannot follow it.',
        'Import the type at the top with `import type`.',
      ]);
    }
    if (!top) continue;
    if (word === 'declare') {
      refuse(file, source, at, 'uses `declare`', [
        "Its text is copied into a namespace of your frontend's types file, where `declare` is not allowed.",
        'Drop `declare`, or move the declaration into another module.',
      ]);
    }
    if (word === 'import') rewrites.push(...(await importRewrites(file, source, code, at)));
    if (word === 'export') {
      if (matchAt(EXPORT_ROUTES, code, at)) routes = true;
      rewrites.push(...(await exportRewrites(file, source, code, at)));
    }
  }
  routes ||= rewrites.some((rewrite) => rewrite.exports.includes('Routes'));
  return { source, rewrites, literal, routes };
}

/**
 * Strips `file`, turning a construct the stripper cannot erase, like an `enum`, into a refusal.
 */
async function strip(file: string): Promise<string> {
  try {
    return (await stripFile(file)) ?? '';
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    const runtime = (error as NodeJS.ErrnoException).code === 'ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX';
    throw ohneError({
      title: runtime
        ? `Contract module ${codeSpan(shown(file))} holds runtime code`
        : `Cannot read contract module ${codeSpan(shown(file))}`,
      body: [
        `${error.message}.`,
        ...(runtime
          ? ["Its text is copied into your frontend's types file, so it may hold only types."]
          : []),
      ],
      path: file,
    });
  }
}

/**
 * The rewrites of the `import type` statement at `at`.
 */
async function importRewrites(
  file: string,
  source: string,
  code: string,
  at: number,
): Promise<Rewrite[]> {
  const named = matchAt(IMPORT_NAMED, code, at);
  if (named) return [await aliases(file, source, at, named, 'import', named[1]!)];
  const all = matchAt(IMPORT_ALL, code, at);
  if (all) return [await aliases(file, source, at, all, 'import')];
  if (matchAt(IMPORT_DEFAULT, code, at)) {
    refuse(file, source, at, 'uses a default import', [
      "Its types are copied into a namespace of your frontend's types file, which has no default export.",
      'Import the type by its name.',
    ]);
  }
  refuse(file, source, at, 'uses an unsupported import', [
    'Import types as `import type { A } from` or `import type * as N from`.',
  ]);
}

/**
 * The rewrites of the top-level `export` statement at `at`; a declaration needs none.
 */
async function exportRewrites(
  file: string,
  source: string,
  code: string,
  at: number,
): Promise<Rewrite[]> {
  const named = matchAt(EXPORT_NAMED, code, at);
  if (named) return [await aliases(file, source, at, named, 'export import', named[1]!)];
  const all = matchAt(EXPORT_ALL, code, at);
  if (all) return [await aliases(file, source, at, all, 'export import')];
  if (matchAt(EXPORT_STAR, code, at)) {
    refuse(file, source, at, 'uses `export type *`', [
      'The types file copies only the names a module lists.',
      'Name them in `export type { A } from`, or use `export type * as N from`.',
    ]);
  }
  if (matchAt(EXPORT_LIST, code, at)) {
    refuse(file, source, at, 'uses an export list', [
      'The types file cannot copy an `export type { ... }` without `from`.',
      'Export each type where you declare it.',
    ]);
  }
  if (matchAt(EXPORT_DEFAULT, code, at)) refuseDefaultExport(file, source, at);
  if (matchAt(EXPORT_DECLARE, code, at) || matchAt(EXPORT_OTHER, code, at)) {
    refuse(file, source, at, 'uses an unsupported export', [
      'Export types as `export interface`, `export type`, or `export type { A } from`.',
    ]);
  }
  return [];
}

/**
 * Turns the statement `match` found at `at` into `keyword` aliases of the module it names.
 * A braced `list` aliases each named type; without one, the statement aliases the whole module.
 */
async function aliases(
  file: string,
  source: string,
  at: number,
  match: RegExpExecArray,
  keyword: 'import' | 'export import',
  list?: string,
): Promise<Rewrite> {
  const pairs = isUndefined(list) ? [] : specifiers(file, source, at, list);
  const names = isUndefined(list) ? [match[1]!] : pairs.map(([, alias]) => alias);
  if (keyword === 'export import' && names.includes('default'))
    refuseDefaultExport(file, source, at);
  const target = await resolveTarget(file, source, match, at);
  return {
    start: at,
    end: at + match[0].length,
    target,
    via: `${file}:${textPosition(source, at)}`,
    exports: keyword === 'import' ? [] : names,
    // `export import` binds the name too, and oxlint refuses a name aliased twice.
    render: (ns, exported) =>
      isUndefined(list)
        ? keyword === 'import' && exported.has(match[1]!)
          ? ''
          : `${keyword} ${match[1]} = ${ns};`
        : pairs
            .filter(([, alias]) => keyword !== 'import' || !exported.has(alias))
            .map(([name, alias]) => `${keyword} ${alias} = ${ns}.${name};`)
            .join('\n'),
  };
}

/**
 * Resolves the specifier of the statement `match` found at `at`, refusing one that names no `.ts` file.
 */
async function resolveTarget(
  file: string,
  source: string,
  match: RegExpExecArray,
  at: number,
): Promise<string> {
  const specifier = match[3]!;
  const position = at + match[0].lastIndexOf(specifier);
  const target = specifier.startsWith('.')
    ? await resolveImport(file, specifier)
    : await resolvePackageImport(file, specifier);
  if (isNull(target)) {
    throw ohneError({
      title: `Cannot resolve ${codeSpan(specifier)} in a contract module`,
      body: [
        'Node finds no module by that name from this file.',
        'Fix the path, or install the package.',
      ],
      path: `${file}:${textPosition(source, position)}`,
    });
  }
  if (!target.endsWith('.ts') || target.endsWith('.d.ts')) {
    throw ohneError({
      title: `Contract import ${codeSpan(specifier)} is not a \`.ts\` module`,
      body: [
        "A contract module's text is copied into your frontend's types file, which takes only `.ts` modules.",
        'Move the types into a `.ts` file.',
      ],
      path: `${file}:${textPosition(source, position)}`,
    });
  }
  return target;
}

/**
 * Reads the `name` / `name as alias` pairs of a braced specifier list.
 */
function specifiers(file: string, source: string, at: number, list: string): [string, string][] {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => {
      const match = SPECIFIER.exec(part);
      if (isNull(match)) {
        refuse(file, source, at, 'uses an unsupported import', [
          `The types file cannot copy ${codeSpan(part)}.`,
          'Name each type plainly, like `A` or `A as B`.',
        ]);
      }
      return [match[1]!, match[2] ?? match[1]!];
    });
}

/**
 * Renders a module's text with its rewrites applied, indented one level.
 * A line that starts inside a string or template literal keeps its text exactly.
 */
function render(module: Parsed, names: Map<string, string>): string {
  const { source, rewrites, literal } = module;
  const begin = source.search(/\S/);
  if (begin === -1) return '';
  const finish = source.trimEnd().length;
  const exported = new Set(rewrites.flatMap((rewrite) => rewrite.exports));
  let out = '  ';
  let at = begin;
  for (const { start, end, target, render } of rewrites) {
    const text = render(names.get(target)!, exported);
    out += indent(source, at, start, literal) + text.replaceAll('\n', '\n  ');
    at = isEmpty(text) ? end + /^\s*/.exec(source.slice(end))![0].length : end;
  }
  return out + indent(source, at, finish, literal);
}

/**
 * Indents every line of `source` between `from` and `to` that does not start inside a literal.
 */
function indent(source: string, from: number, to: number, literal: Set<number>): string {
  let out = '';
  for (let i = from; i < to; i++) {
    out += source[i];
    if (source[i] !== '\n' || literal.has(i)) continue;
    const next = source[i + 1];
    if (next !== '\n' && next !== '\r') out += '  ';
  }
  return out;
}

/**
 * The offset of the first character of `stripped` that is neither whitespace nor a comment, else `-1`.
 */
function firstCode(stripped: string): number {
  let i = 0;
  while (i < stripped.length) {
    if (/\s/.test(stripped[i]!)) i++;
    else if (stripped.startsWith('//', i)) i = lineEnd(stripped, i);
    else if (stripped.startsWith('/*', i)) i = blockEnd(stripped, i);
    else return i;
  }
  return -1;
}

/**
 * Refuses the runtime code that starts at `at` in the stripped text, naming it when it declares a value.
 */
function refuseRuntime(file: string, source: string, stripped: string, at: number): never {
  const rest = stripped.slice(at);
  const name = RUNTIME_NAME.exec(rest)?.[1];
  const fix = !isUndefined(name)
    ? `Move ${codeSpan(name)} into a runtime module and keep only its type here.`
    : /^(?:import|export)\b/.test(rest)
      ? 'Write it as `import type` or `export type`, which leaves nothing behind.'
      : 'Move it into a runtime module and keep only types here.';
  refuse(file, source, at, 'holds runtime code', [
    "Its text is copied into your frontend's types file, so it may hold only types.",
    fix,
  ]);
}

/**
 * Refuses the default export at `at`, which a namespace cannot carry.
 */
function refuseDefaultExport(file: string, source: string, at: number): never {
  refuse(file, source, at, 'uses a default export', [
    "Its types are copied into a namespace of your frontend's types file, which has no default export.",
    'Export the type by its name.',
  ]);
}

/**
 * Throws the block `Contract module <file> <what>` with `body`, pointing at `at` in `source`.
 */
function refuse(file: string, source: string, at: number, what: string, body: string[]): never {
  throw ohneError({
    title: `Contract module ${codeSpan(shown(file))} ${what}`,
    body,
    path: `${file}:${textPosition(source, at)}`,
  });
}

/**
 * Scans type-only `source` for the `import`, `export`, and `declare` keywords outside literals and comments.
 * A keyword is `top` when no bracket encloses it.
 * `code` is `source` with every comment blanked, and `literal` holds each newline inside a literal.
 */
function scan(source: string): Scan {
  const keywords: Scan['keywords'] = [];
  const literal = new Set<number>();
  const templates: number[] = [];
  let code = '';
  let copied = 0;
  let depth = 0;
  let previous = '';
  let i = 0;
  while (i < source.length) {
    const char = source[i]!;
    if (char === '/' && (source[i + 1] === '/' || source[i + 1] === '*')) {
      const end = source[i + 1] === '/' ? lineEnd(source, i) : blockEnd(source, i);
      code += source.slice(copied, i) + source.slice(i, end).replace(/[^\n]/g, ' ');
      copied = end;
      i = end;
      continue;
    }
    if (char === "'" || char === '"') {
      i = stringEnd(source, i, char, literal);
      previous = char;
      continue;
    }
    if (char === '`' || (char === '}' && templates.at(-1) === depth)) {
      if (char === '}') templates.pop();
      i = templateEnd(source, i + 1, literal, () => templates.push(depth));
      previous = '`';
      continue;
    }
    if (OPENERS.has(char)) depth++;
    else if (CLOSERS.has(char)) depth--;
    else if (/[\w$]/.test(char)) {
      const word = matchAt(IDENTIFIER, source, i)![0];
      if ((word === 'import' || word === 'export' || word === 'declare') && previous !== '.') {
        keywords.push({ word, at: i, top: depth === 0 });
      }
      i += word.length;
      previous = 'a';
      continue;
    }
    if (!/\s/.test(char)) previous = char;
    i++;
  }
  return { code: code + source.slice(copied), keywords, literal };
}

/**
 * The offset just past the string literal opened by `quote` at `start`, recording its escaped newlines.
 */
function stringEnd(source: string, start: number, quote: string, literal: Set<number>): number {
  let i = start + 1;
  while (i < source.length && source[i] !== quote && source[i] !== '\n') {
    if (source[i] === '\\') {
      if (source[i + 1] === '\n') literal.add(i + 1);
      i++;
    }
    i++;
  }
  return i + 1;
}

/**
 * The offset where the template text from `start` ends: past its closing backtick, or past a `${`.
 * A `${` calls `open`, so the scan resumes the template at its matching `}`.
 */
function templateEnd(
  source: string,
  start: number,
  literal: Set<number>,
  open: () => void,
): number {
  let i = start;
  while (i < source.length) {
    const char = source[i];
    if (char === '\\') i += 2;
    else if (char === '`') return i + 1;
    else if (char === '$' && source[i + 1] === '{') {
      open();
      return i + 2;
    } else {
      if (char === '\n') literal.add(i);
      i++;
    }
  }
  return i;
}

/**
 * The offset of the newline that ends the line comment at `start`, or the end of `text`.
 */
function lineEnd(text: string, start: number): number {
  const end = text.indexOf('\n', start);
  return end === -1 ? text.length : end;
}

/**
 * The offset just past the block comment at `start`, or the end of `text`.
 */
function blockEnd(text: string, start: number): number {
  const end = text.indexOf('*/', start + 2);
  return end === -1 ? text.length : end + 2;
}

/**
 * Runs the sticky `pattern` at offset `at` of `text`.
 */
function matchAt(pattern: RegExp, text: string, at: number): RegExpExecArray | null {
  pattern.lastIndex = at;
  return pattern.exec(text);
}

/**
 * The `line:col` of offset `at` in `text`, both one-based.
 */
function textPosition(text: string, at: number): string {
  return `${lineCount(text.slice(0, at))}:${at - text.lastIndexOf('\n', at - 1)}`;
}

/**
 * `file` as the reader sees it, relative to the working directory.
 */
function shown(file: string): string {
  return relativePath(process.cwd(), file);
}
