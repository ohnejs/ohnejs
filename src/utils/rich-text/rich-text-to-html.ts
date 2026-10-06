import type { Node, ReadRun } from './_read.ts';
import type { RichTextHeadingLevel, RichTextOptions } from './rich-text.ts';

import { isSafeHref } from '../html/is-safe-href.ts';
import { isArray } from '../is/is-array.ts';
import { isPlainObject } from '../is/is-plain-object.ts';
import { isString } from '../is/is-string.ts';
import { isUndefined } from '../is/is-undefined.ts';
import { deepEqual } from '../object/deep-equal.ts';
import { escapeXML } from '../xml/escape-xml.ts';
import { leaves, readList, readRuns } from './_read.ts';

const LEVELS: readonly RichTextHeadingLevel[] = [2, 3, 4, 5, 6];
const NEW_TAB = ' target="_blank" rel="noopener noreferrer"';

/**
 * Renders a rich text value as HTML, with no whitespace between tags.
 * A paragraph is a `<p>`, a heading an `<h2>` to `<h6>`, and a quote a `<blockquote><p>`.
 * A list is a `<ul>` or `<ol>`, and each item an `<li>` holding its runs, then its nested list.
 * Text and attributes go through `escapeXML`, `\n` becomes `<br>`, and an empty leaf renders as `<br>`.
 * Marks nest in `RICH_TEXT_MARKS` order from outer to inner, inside the `<a>` of a link.
 * Neighbouring runs with an equal link share one `<a>`, and `newTab` adds `target` and `rel` after `href`.
 * The `<a>` takes `url` from a URL link and `href` from a record link, and only when `isSafeHref` passes.
 * Under `inline`, block tags are dropped and each block and item boundary becomes a `<br>`.
 * A malformed value, such as a preview draft, renders what can be read and never throws.
 *
 * @example
 * ```ts
 * richTextToHTML([
 *   { kind: 'heading', level: 2, content: [{ text: 'Hi' }] },
 *   { kind: 'paragraph', content: [{ text: 'a & ', marks: ['em'] }, { text: 'b', link: { url: '/b' } }] },
 * ])
 * // -> '<h2>Hi</h2><p><em>a &amp; </em><a href="/b">b</a></p>'
 *
 * richTextToHTML([{ kind: 'paragraph', content: [{ text: 'a\nb' }] }], { inline: true })
 * // -> 'a<br>b'
 * ```
 */
export function richTextToHTML(
  value: unknown,
  { inline = false }: Pick<RichTextOptions, 'inline'> = {},
): string {
  if (!inline) return isArray(value) ? value.map(renderBlock).join('') : '';
  const lines = leaves(value).map((leaf) => renderRuns(leaf.runs));
  return lines.join('<br>');
}

/**
 * Renders a top-level block, or `''` when it cannot be read.
 */
function renderBlock(node: unknown): string {
  if (!isPlainObject(node)) return '';
  const { kind } = node;
  if (kind === 'list') return renderList(node, 0);
  if (kind === 'paragraph') return `<p>${renderLeaf(node)}</p>`;
  if (kind === 'quote') return `<blockquote><p>${renderLeaf(node)}</p></blockquote>`;
  const level = kind === 'heading' ? LEVELS.find((level) => level === node.level) : undefined;
  return level ? `<h${level}>${renderLeaf(node)}</h${level}>` : '';
}

/**
 * Renders a list that `depth` lists already enclose, or `''` when `readList` refuses it.
 */
function renderList(node: unknown, depth: number): string {
  const list = readList(node, depth);
  if (!list) return '';
  const tag = list.ordered ? 'ol' : 'ul';
  const items = list.items.map((item) =>
    isPlainObject(item) ? `<li>${renderLeaf(item)}${renderList(item.list, depth + 1)}</li>` : '',
  );
  return `<${tag}>${items.join('')}</${tag}>`;
}

/**
 * Renders the runs of a block or item, as `<br>` when nothing is left.
 */
function renderLeaf(node: Node): string {
  return renderRuns(readRuns(node.content)) || '<br>';
}

/**
 * Renders runs, grouping neighbours with an equal link under one `<a>`.
 */
function renderRuns(runs: readonly ReadRun[]): string {
  const groups: { link: unknown; html: string }[] = [];
  for (const run of runs) {
    if (run.text === '') continue;
    const last = groups.at(-1);
    if (last && deepEqual(last.link, run.link)) last.html += renderRun(run);
    else groups.push({ link: run.link, html: renderRun(run) });
  }
  return groups.map(({ link, html }) => renderLink(link, html)).join('');
}

/**
 * Wraps `html` in the `<a>` of `link`, or returns it as is when the link gives no safe `href`.
 */
function renderLink(link: unknown, html: string): string {
  if (!isPlainObject(link)) return html;
  const href = isUndefined(link.collection) ? link.url : link.href;
  if (!isString(href) || !isSafeHref(href)) return html;
  return `<a href="${escapeXML(href)}"${link.newTab === true ? NEW_TAB : ''}>${html}</a>`;
}

/**
 * Renders one run's text inside its marks.
 */
function renderRun({ text, marks }: ReadRun): string {
  return marks.reduceRight(
    (html, mark) => `<${mark}>${html}</${mark}>`,
    escapeXML(text).replaceAll('\n', '<br>'),
  );
}
