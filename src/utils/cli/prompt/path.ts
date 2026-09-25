import type { Dirent } from 'node:fs';

import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';

import type { ANSIColors } from '../../ansi/pick-ansi-colors.ts';
import type { PromptDefinition, PromptState } from './_prompt.ts';
import type { Validate } from './validate.ts';

import { toArray } from '../../array/to-array.ts';
import { fuzzyMatch } from '../../fuzzy/fuzzy.ts';
import { isNull } from '../../is/is-null.ts';
import { isUndefined } from '../../is/is-undefined.ts';
import { createKeymap } from '../../keys/create-keymap.ts';
import { strokeFromReadlineKey } from '../../keys/stroke-from-readline-key.ts';
import { basename } from '../../path/basename.ts';
import { expandTilde } from '../../path/expand-tilde.ts';
import { extname } from '../../path/extname.ts';
import { joinPath } from '../../path/join-path.ts';
import { normalizePath } from '../../path/normalize-path.ts';
import { resolvePath } from '../../path/resolve-path.ts';
import { leadIn, titleLine } from './_frame.ts';
import { caretValue, clipEnd, createLineEditor, isPrintable } from './_line.ts';
import { optionListBody } from './option.ts';
import { closingRail } from './validate.ts';

/**
 * One filesystem entry offered as a completion.
 */
export interface PathEntry {
  /**
   * Base name including the extension (e.g. `'index.ts'`).
   */
  name: string;

  /**
   * Absolute, normalized path to the entry.
   */
  path: string;

  /**
   * Entry type.
   */
  type: 'file' | 'directory';
}

/**
 * Options for a path prompt.
 */
export interface PathOptions {
  /**
   * The question shown above the input.
   */
  message: string;

  /**
   * Value the input starts with, editable by the user.
   *
   * @default
   * ''
   */
  initialValue?: string;

  /**
   * Base directory relative input is resolved against, and the root for an absolute result.
   *
   * @default
   * process.cwd()
   */
  root?: string;

  /**
   * Restrict what can be picked.
   * `'directory'` hides files.
   * `'file'` keeps directories visible for navigation, but only a file may be submitted.
   * Omitted lets a file or a directory be picked.
   */
  only?: 'file' | 'directory';

  /**
   * Restrict file completions to these extensions.
   * Each value may be written with or without a leading dot (`'ts'` and `'.ts'` are equivalent).
   * Has no effect on directories, which always show for navigation.
   * Omitted completes files of every extension.
   */
  ext?: string | string[];

  /**
   * Keep only the file entries the predicate accepts.
   * Runs after `only` and `ext`, and only for files; directories are never passed.
   * Omitted keeps every file.
   */
  filter?: (entry: PathEntry) => boolean;

  /**
   * Offer entries whose name starts with `.`.
   * Hidden entries show regardless once the typed fragment itself starts with `.`.
   *
   * @default
   * false
   */
  hidden?: boolean;

  /**
   * Resolve the result against `root` into an absolute path.
   * When `false`, the typed value is returned normalized, staying relative if it was typed relative.
   *
   * @default
   * true
   */
  absolute?: boolean;

  /**
   * Reject a path that does not exist on submit.
   *
   * @default
   * false
   */
  mustExist?: boolean;

  /**
   * Most completion rows shown at once before the list scrolls to keep the cursor in view.
   *
   * @default
   * 8
   */
  maxItems?: number;

  /**
   * Rejects a value the user tries to submit.
   * Runs against the effective result, after the built-in `only` and `mustExist` checks pass.
   */
  validate?: Validate<string>;
}

const WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';

const plain = (char: string): string => char;

interface Match {
  entry: PathEntry;
  score: number;
  positions: number[];
}

/**
 * Builds the definition for a path prompt with live folder completion.
 * The typed value splits at its last separator.
 * The prefix names the directory to list.
 * The rest fuzzy-matches its entries, ranking the matched run first.
 *
 * - `tab` fills in the highlighted entry, appending `/` for a directory so you keep descending.
 * - `up`/`down` move the highlight through the matches, which scroll past `maxItems`.
 * - Printable keys insert and the usual line edits apply, with word jumps stopping at each `/`.
 * - `enter` submits the typed value once `only`, `mustExist`, and `validate` accept it.
 *
 * A leading `~` stands for the home directory, in the completions and the result.
 * The result is normalized to `/` separators, so a value works on every platform.
 */
export function pathDefinition(options: PathOptions): PromptDefinition<string> {
  const root = options.root ?? process.cwd();
  const home = homedir();
  const max = options.maxItems ?? 8;
  const exts = isUndefined(options.ext) ? null : normalizeExts(options.ext);
  const editor = createLineEditor(options.initialValue ?? '', { wordSeparators: WORD_SEPARATORS });
  const cache = new Map<string, PathEntry[]>();

  let error: string | undefined;
  let cursor = 0;
  let matches = complete(editor.value);
  let current: PromptState<string>;

  /**
   * Lists `dir` as completion entries, cached per directory and empty when it cannot be read.
   * A name holding a control character is left out, since no one could type it.
   */
  function read(dir: string): PathEntry[] {
    const hit = cache.get(dir);
    if (!isUndefined(hit)) return hit;
    let entries: PathEntry[];
    try {
      entries = readdirSync(dir, { withFileTypes: true })
        .map((dirent) => entryOf(dirent, dir))
        .filter((entry): entry is PathEntry => !isUndefined(entry) && isPrintable(entry.name));
    } catch {
      entries = [];
    }
    cache.set(dir, entries);
    return entries;
  }

  /**
   * Fuzzy-matches the typed value's last segment against its directory's entries, best first.
   */
  function complete(value: string): Match[] {
    const fragment = endsWithSep(value) ? '' : basename(value);
    const prefix = value.slice(0, value.length - fragment.length);
    const dir = resolvePath(expandTilde(prefix, home), root);
    const showHidden = options.hidden || fragment.startsWith('.');

    const scored: Match[] = [];
    for (const entry of read(dir)) {
      if (!showHidden && entry.name.startsWith('.')) continue;
      if (!keep(entry)) continue;
      const match = fuzzyMatch(fragment, entry.name);
      if (isNull(match)) continue;
      scored.push({ entry, score: match.score, positions: match.positions });
    }
    return scored.sort((a, b) => rank(a, b, fragment));
  }

  /**
   * Whether an entry passes `only`, `ext`, and `filter`; directories always pass for navigation.
   */
  function keep(entry: PathEntry): boolean {
    if (entry.type === 'directory') return true;
    if (options.only === 'directory') return false;
    if (exts && !exts.has(extname(entry.name))) return false;
    return options.filter ? options.filter(entry) : true;
  }

  const refresh = (): void => {
    matches = complete(editor.value);
    cursor = 0;
  };

  const move = (delta: number): void => {
    if (matches.length > 0) cursor = (cursor + delta + matches.length) % matches.length;
  };

  const typeChar = (str: string): void => {
    const before = (): string | undefined => [...editor.value][editor.cursor - 1];
    if (str === ' ' || str === '\t') {
      const prev = before();
      if (isUndefined(prev) || prev === ' ' || prev === '\t' || prev === '/' || prev === '\\')
        return;
    } else if (str === '/' || str === '\\') {
      for (let prev = before(); prev === ' ' || prev === '\t'; prev = before())
        editor.deleteCharLeft();
    }
    editor.insert(str);
  };

  const fill = (): void => {
    const entry = matches[cursor]?.entry;
    if (isUndefined(entry)) return;
    const value = editor.value;
    const prefix = endsWithSep(value)
      ? value
      : value.slice(0, value.length - basename(value).length);
    // A leading `~` would read as the home directory, so an entry named `~` keeps its `./`.
    const name = prefix === '' && entry.name === '~' ? './~' : entry.name;
    editor.set(prefix + name + (entry.type === 'directory' ? '/' : ''));
    refresh();
  };

  const submit = (): void => {
    const trimmed = editor.value.trim();
    const typed = trimmed === '' ? '.' : expandTilde(trimmed, home);
    const target = resolvePath(typed, root);
    const found = inspect(target);

    if (options.mustExist && !found.exists) error = 'Path does not exist.';
    else if (options.only === 'file' && found.type === 'directory') error = 'Select a file.';
    else if (options.only === 'directory' && found.type === 'file') error = 'Select a directory.';

    const value = options.absolute === false ? normalizePath(typed) : target;
    if (isUndefined(error)) error = options.validate?.(value);
    if (!isUndefined(error)) return;
    current.value = value;
    current.status = 'submit';
  };

  const edit = (run: () => void): (() => void) => {
    return () => {
      run();
      refresh();
    };
  };

  const keymap = createKeymap({
    enter: submit,
    tab: fill,
    arrowdown: () => move(1),
    arrowup: () => move(-1),
    arrowleft: editor.charLeft,
    arrowright: editor.charRight,
    'ctrl+arrowleft': editor.wordLeft,
    'alt+arrowleft': editor.wordLeft,
    'ctrl+arrowright': editor.wordRight,
    'alt+arrowright': editor.wordRight,
    home: editor.lineStart,
    'ctrl+a': editor.lineStart,
    end: editor.lineEnd,
    'ctrl+e': editor.lineEnd,
    backspace: edit(editor.deleteCharLeft),
    'ctrl+w': edit(editor.deleteWordLeft),
    'alt+backspace': edit(editor.deleteWordLeft),
    'ctrl+backspace': edit(editor.deleteWordLeft),
    delete: edit(editor.deleteCharRight),
    'ctrl+d': edit(editor.deleteCharRight),
    'alt+d': edit(editor.deleteWordRight),
    'ctrl+delete': edit(editor.deleteWordRight),
    'alt+delete': edit(editor.deleteWordRight),
    'ctrl+u': edit(editor.deleteToStart),
    'ctrl+k': edit(editor.deleteToEnd),
  });

  return {
    initialValue: options.initialValue ?? '',

    render(state, { colors, lead, columns }) {
      const active = state.status === 'active';
      const rail = isUndefined(error) ? colors.dim('│') : colors.red('│');
      const width = isUndefined(columns) ? undefined : Math.max(1, columns - 4);
      const value = active
        ? caretValue(state.value, editor.cursor, undefined, colors, width)
        : colors.dim(clipEnd(state.value, width));

      const valueLine = `${rail}  ${value}`;
      const close = closingRail(error, colors);
      const list = active ? `${listBody(matches, cursor, max, colors, rail)}\n` : '';
      const body = active ? `${rail}\n${valueLine}\n${list}${close}` : valueLine;
      const block = `${titleLine(options.message, state.status, error, colors)}\n${body}`;
      return leadIn(block, lead, colors);
    },

    onKey(key, str, state) {
      current = state;
      error = undefined;
      if (!keymap(strokeFromReadlineKey(str, key)) && isPrintable(str)) {
        typeChar(str!);
        refresh();
      }
      if (state.status === 'active') current.value = editor.value;
    },
  };
}

/**
 * Renders the completion rows, or a dim `no matches` row when there are none.
 */
function listBody(
  matches: Match[],
  cursor: number,
  max: number,
  colors: ANSIColors,
  rail: string,
): string {
  if (matches.length === 0) return `${rail}  ${colors.dim('no matches')}`;
  return optionListBody(
    matches.length,
    cursor,
    max,
    colors,
    (i) => row(matches[i], i === cursor, colors),
    rail,
  );
}

/**
 * Draws one completion with its matched characters marked and a trailing `/` on a directory.
 */
function row(match: Match, active: boolean, colors: ANSIColors): string {
  const { entry } = match;
  const name = entry.type === 'directory' ? `${entry.name}/` : entry.name;
  const base = active ? plain : colors.dim;
  const mark = active ? (char: string): string => colors.cyan(colors.bold(char)) : colors.bold;
  const label = highlight(name, match.positions, base, mark);
  return active ? `${colors.cyan('●')} ${label}` : `${colors.dim('○')} ${label}`;
}

/**
 * Styles each character of `name` with `mark` at the matched `positions` and `base` elsewhere.
 */
function highlight(
  name: string,
  positions: number[],
  base: (char: string) => string,
  mark: (char: string) => string,
): string {
  if (positions.length === 0) return base(name);
  let out = '';
  let next = 0;
  for (let i = 0; i < name.length; i += 1) {
    const matched = positions[next] === i;
    if (matched) next += 1;
    out += matched ? mark(name[i]) : base(name[i]);
  }
  return out;
}

/**
 * Orders matches by descending score, falling back to `byKind` on a tie or an empty fragment.
 */
function rank(a: Match, b: Match, fragment: string): number {
  if (fragment === '') return byKind(a.entry, b.entry);
  if (a.score !== b.score) return b.score - a.score;
  return byKind(a.entry, b.entry);
}

/**
 * Sorts directories before files, then by case-insensitive name.
 */
function byKind(a: PathEntry, b: PathEntry): number {
  if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
  return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1;
}

/**
 * Builds a completion entry for a dirent, or `undefined` when it is neither file nor directory.
 */
function entryOf(dirent: Dirent, dir: string): PathEntry | undefined {
  const path = joinPath(dir, dirent.name);
  const type = kindOf(dirent, path);
  return isUndefined(type) ? undefined : { name: dirent.name, path, type };
}

/**
 * Classifies a dirent as file or directory, resolving a symlink through its target.
 */
function kindOf(dirent: Dirent, path: string): 'file' | 'directory' | undefined {
  if (dirent.isDirectory()) return 'directory';
  if (dirent.isFile()) return 'file';
  if (dirent.isSymbolicLink()) return inspect(path).type;
  return undefined;
}

/**
 * Stats `path`, reporting a failed stat as `exists: false` and any non-directory as a file.
 */
function inspect(path: string): { exists: boolean; type?: 'file' | 'directory' } {
  try {
    const stats = statSync(path);
    return { exists: true, type: stats.isDirectory() ? 'directory' : 'file' };
  } catch {
    return { exists: false };
  }
}

/**
 * Collects extensions into a set, each with its leading dot.
 */
function normalizeExts(ext: string | string[]): Set<string> {
  return new Set(toArray(ext).map((value) => (value.startsWith('.') ? value : `.${value}`)));
}

/**
 * Whether `value` ends in a `/` or `\` separator.
 */
function endsWithSep(value: string): boolean {
  return value.endsWith('/') || value.endsWith('\\');
}
