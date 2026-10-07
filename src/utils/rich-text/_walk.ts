import type { RichTextIssue } from './rich-text.ts';

import { isSafeHref } from '../html/is-safe-href.ts';
import { isArray } from '../is/is-array.ts';
import { isBoolean } from '../is/is-boolean.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { isUUID } from '../uuid/is-uuid.ts';
import { RICH_TEXT_MARKS, RICH_TEXT_MAX_LIST_DEPTH } from './rich-text.ts';

/**
 * Receives each issue a walk finds, in document order.
 */
export type Report = (
  path: string,
  key: RichTextIssue['key'],
  params?: Record<string, unknown>,
) => void;

/**
 * The allowed sets a walk enforces on top of the structure.
 */
export interface Policy {
  /**
   * Whether the value holds at most one paragraph.
   */
  inline: boolean;

  /**
   * The block elements allowed besides paragraphs.
   */
  elements: ReadonlySet<unknown>;

  /**
   * The marks allowed on text.
   */
  marks: ReadonlySet<unknown>;

  /**
   * The links allowed, where a set names the collections a record link may point into.
   */
  links: LinkPolicy;
}

/**
 * The links a walk allows: none, URLs, or URLs and records in the named collections.
 */
export type LinkPolicy = boolean | ReadonlySet<unknown>;

type Node = Record<string, unknown>;

interface Walk {
  policy: Policy | undefined;
  report: Report;
}

const INVALID = 'validation.invalidValue';
const REQUIRED = 'validation.required';
const CHOICE = 'validation.invalidChoice';

const BLOCK_KEYS = new Map<unknown, readonly string[]>([
  ['paragraph', ['kind', 'content']],
  ['heading', ['kind', 'level', 'content']],
  ['quote', ['kind', 'content']],
  ['list', ['kind', 'ordered', 'items']],
]);
const ITEM_KEYS = ['content', 'list'];
const RUN_KEYS = ['text', 'marks', 'link'];
const RECORD_LINK_KEYS = ['collection', 'record', 'hash', 'newTab', 'href'];
const URL_LINK_KEYS = ['url', 'newTab', 'href'];

const MARKS: ReadonlySet<unknown> = new Set(RICH_TEXT_MARKS);
const LEVELS: ReadonlySet<unknown> = new Set([2, 3, 4, 5, 6]);
const HEADINGS = ['h2', 'h3', 'h4', 'h5', 'h6'];
const LISTS = ['ul', 'ol'];
const REFUSED_HASH = /[\s#\p{Cc}]/u;

/**
 * Runs a walk and gathers what it reports.
 *
 * @example
 * ```ts
 * collectIssues((report) => walkRichText({}, undefined, report))
 * // -> [{ path: '', key: 'validation.invalidValue' }]
 * ```
 */
export function collectIssues(walk: (report: Report) => void): RichTextIssue[] {
  const issues: RichTextIssue[] = [];
  walk((path, key, params) =>
    issues.push(isUndefined(params) ? { path, key } : { path, key, params }),
  );
  return issues;
}

/**
 * Turns the `links` option into the policy a walk reads.
 *
 * @example
 * ```ts
 * linkPolicy(true)      // -> true
 * linkPolicy(['Pages']) // -> Set { 'Pages' }
 * ```
 */
export function linkPolicy(links: boolean | readonly string[]): LinkPolicy {
  return isBoolean(links) ? links : new Set(links);
}

/**
 * Walks a rich text value in document order and reports each problem once, at its path.
 * Without a policy it judges structure only: kinds, keys, types and list depth.
 * A node reports its scalar keys, then its unknown keys, then descends into its arrays and nested nodes.
 * A key holding `undefined` counts as absent.
 *
 * @example
 * ```ts
 * collectIssues((report) => walkRichText([{ kind: 'aside' }], undefined, report))
 * // -> [{ path: '[0].kind', key: 'validation.invalidValue' }]
 * ```
 */
export function walkRichText(value: unknown, policy: Policy | undefined, report: Report): void {
  if (!isArray(value)) return report('', INVALID);
  const walk = { policy, report };
  for (const [index, block] of value.entries()) {
    if (policy?.inline && index > 0) return report(`[${index}]`, 'validation.singleParagraph');
    walkBlock(block, `[${index}]`, 0, walk);
  }
}

/**
 * Walks a link and reports each problem once, at its path under `path`.
 * Without a policy it judges structure only: keys, types and a `UUID` record.
 *
 * @example
 * ```ts
 * collectIssues((report) => walkLink({ url: 'javascript:x' }, '', true, report))
 * // -> [{ path: 'url', key: 'validation.invalidLink' }]
 * ```
 */
export function walkLink(
  value: unknown,
  path: string,
  links: LinkPolicy | undefined,
  report: Report,
): void {
  if (links === false) return report(path, 'validation.linksNotAllowed');
  if (!isPlainObject(value)) return report(path, INVALID);
  const record = !isUndefined(value.collection);
  if (!record && isUndefined(value.url)) return report(path, INVALID);
  if (record) walkRecordTarget(value, path, links, report);
  else walkURLTarget(value, path, links, report);
  optional(value, 'newTab', isBoolean, path, report);
  optional(value, 'href', isString, path, report);
  unknownKeys(value, record ? RECORD_LINK_KEYS : URL_LINK_KEYS, path, report);
}

/**
 * Walks a record link's `collection`, `record` and `hash`.
 */
function walkRecordTarget(
  link: Node,
  path: string,
  links: LinkPolicy | undefined,
  report: Report,
): void {
  if (!isString(link.collection)) report(at(path, 'collection'), INVALID);
  else if (!isUndefined(links) && (isBoolean(links) || !links.has(link.collection))) {
    report(at(path, 'collection'), CHOICE);
  }
  required(link, 'record', isUUID, path, report);
  optional(link, 'hash', isString, path, report);
  if (!isUndefined(links) && isString(link.hash) && REFUSED_HASH.test(link.hash)) {
    report(at(path, 'hash'), INVALID);
  }
}

/**
 * Walks a URL link's `url`.
 */
function walkURLTarget(
  link: Node,
  path: string,
  links: LinkPolicy | undefined,
  report: Report,
): void {
  if (!isString(link.url)) report(at(path, 'url'), INVALID);
  else if (!isUndefined(links) && !isSafeHref(link.url))
    report(at(path, 'url'), 'validation.invalidLink');
}

/**
 * Walks a top-level block at `depth` 0, or a list nested `depth` lists deep.
 */
function walkBlock(node: unknown, path: string, depth: number, walk: Walk): void {
  if (!isPlainObject(node)) return walk.report(path, INVALID);
  if (depth >= RICH_TEXT_MAX_LIST_DEPTH) {
    return walk.report(path, 'validation.maxDepth', { max: RICH_TEXT_MAX_LIST_DEPTH });
  }
  const { kind } = node;
  const keys = depth === 0 || kind === 'list' ? BLOCK_KEYS.get(kind) : undefined;
  if (isUndefined(kind)) return walk.report(at(path, 'kind'), REQUIRED);
  if (!keys) return walk.report(at(path, 'kind'), INVALID);
  const shaped =
    kind === 'heading'
      ? required(node, 'level', (level) => LEVELS.has(level), path, walk.report)
      : kind === 'list'
        ? required(node, 'ordered', isBoolean, path, walk.report)
        : true;
  const refused = shaped && walk.policy && refusedKey(node, walk.policy);
  if (refused) walk.report(at(path, refused), CHOICE);
  unknownKeys(node, keys, path, walk.report);
  if (kind !== 'list') return walkContent(node.content, at(path, 'content'), walk);
  entries(node.items, at(path, 'items'), walk.report, (item, itemPath) =>
    walkItem(item, itemPath, depth, walk),
  );
}

/**
 * Walks a list item whose list sits `depth` lists deep.
 */
function walkItem(node: unknown, path: string, depth: number, walk: Walk): void {
  if (!isPlainObject(node)) return walk.report(path, INVALID);
  unknownKeys(node, ITEM_KEYS, path, walk.report);
  walkContent(node.content, at(path, 'content'), walk);
  if (!isUndefined(node.list)) walkBlock(node.list, at(path, 'list'), depth + 1, walk);
}

/**
 * Walks the runs of a block or an item.
 */
function walkContent(value: unknown, path: string, walk: Walk): void {
  entries(value, path, walk.report, (run, runPath) => walkRun(run, runPath, walk));
}

/**
 * Walks a run: its text, its marks and its link.
 */
function walkRun(node: unknown, path: string, walk: Walk): void {
  if (!isPlainObject(node)) return walk.report(path, INVALID);
  required(node, 'text', isString, path, walk.report);
  unknownKeys(node, RUN_KEYS, path, walk.report);
  if (!isUndefined(node.marks)) {
    entries(node.marks, at(path, 'marks'), walk.report, (mark, markPath) => {
      if (!MARKS.has(mark)) walk.report(markPath, INVALID);
      else if (walk.policy && !walk.policy.marks.has(mark)) walk.report(markPath, CHOICE);
    });
  }
  if (!isUndefined(node.link))
    walkLink(node.link, at(path, 'link'), walk.policy?.links, walk.report);
}

/**
 * The key a well-shaped block's element choice fails at, or `undefined` when the policy allows it.
 * The kind fails when its whole family is refused, and the level or list type when only that one is.
 */
function refusedKey(node: Node, policy: Policy): string | undefined {
  if (node.kind === 'paragraph') return undefined;
  if (policy.inline) return 'kind';
  if (node.kind === 'quote') return policy.elements.has('blockquote') ? undefined : 'kind';
  const heading = node.kind === 'heading';
  if (policy.elements.has(heading ? `h${node.level}` : node.ordered ? 'ol' : 'ul'))
    return undefined;
  const family = heading ? HEADINGS : LISTS;
  if (!family.some((element) => policy.elements.has(element))) return 'kind';
  return heading ? 'level' : 'ordered';
}

/**
 * Reports a missing or mistyped array at `path`, else walks each entry at its index.
 */
function entries(
  value: unknown,
  path: string,
  report: Report,
  each: (entry: unknown, path: string) => void,
): void {
  if (isUndefined(value)) return report(path, REQUIRED);
  if (!isArray(value)) return report(path, INVALID);
  for (const [index, entry] of value.entries()) each(entry, `${path}[${index}]`);
}

/**
 * Reports a missing or mistyped key, and returns whether its value passes `test`.
 */
function required(
  node: Node,
  key: string,
  test: (value: unknown) => boolean,
  path: string,
  report: Report,
): boolean {
  const value = node[key];
  if (!isUndefined(value) && test(value)) return true;
  report(at(path, key), isUndefined(value) ? REQUIRED : INVALID);
  return false;
}

/**
 * Reports an optional key whose value is present and fails `test`.
 */
function optional(
  node: Node,
  key: string,
  test: (value: unknown) => boolean,
  path: string,
  report: Report,
): void {
  if (!isUndefined(node[key]) && !test(node[key])) report(at(path, key), INVALID);
}

/**
 * Reports each key outside `keys` that holds a value.
 */
function unknownKeys(node: Node, keys: readonly string[], path: string, report: Report): void {
  for (const [key, value] of Object.entries(node)) {
    if (!keys.includes(key) && !isUndefined(value))
      report(at(path, key), 'validation.unknownField');
  }
}

/**
 * The path of `key` under `path`, where `''` is the root.
 */
function at(path: string, key: string): string {
  return path === '' ? key : `${path}.${key}`;
}
