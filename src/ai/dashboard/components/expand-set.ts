import type { ConditionNode } from 'ohnejs/utils';

import { isArray, isString, isUndefined, parseCondition, renderLabel } from 'ohnejs/utils';

import type { Proposal } from './turn-store.ts';

/**
 * One record a write by set reaches.
 */
export interface SetRow {
  /**
   * The record's `UUID`.
   */
  UUID: string;

  /**
   * The record's label from its label fields, `''` when none carries text.
   */
  label: string;

  /**
   * Whether the person may write the record; a row outside their reach is shown but never sent.
   */
  mine: boolean;
}

/**
 * How a collection names its records.
 */
export interface SetLabeling {
  /**
   * The fields whose values name a record.
   */
  labelFields: readonly string[];

  /**
   * The label template over `labelFields`, when the collection declares one.
   */
  labelTemplate?: string;
}

/**
 * One page of records, as `POST /collections/[segment]/query` answers it.
 */
export interface SetPage {
  /**
   * The records on the page.
   */
  records: Record<string, unknown>[];

  /**
   * The number of the last page.
   */
  lastPage: number;
}

/**
 * What the expansion reads through.
 * Injected, so the expansion runs the same under a test double.
 */
export interface SetIO {
  /**
   * Reads one page of the collection with the wire query `body`; a failure answers `undefined`.
   */
  page(body: Record<string, unknown>): Promise<SetPage | undefined>;

  /**
   * The rows among `UUIDs` the proposal's operation may touch.
   */
  verdict(UUIDs: readonly string[]): Promise<ReadonlySet<string>>;
}

/**
 * What putting a filter into words needs.
 */
export interface FilterWords {
  /**
   * The label of a field by its name, or the name itself when unknown.
   */
  field(name: string): string;

  /**
   * Translates one `ai.dashboard.filter.*` key.
   */
  t(key: string, params?: Record<string, string | number>): string;
}

/**
 * The rows a page read fetches at once.
 */
const PER_PAGE = 50;

/**
 * Expands a write by set into the rows it reaches, in the read's order.
 * Every page matching the proposal's `where` is read at its `locale`, then the verdict marks each row.
 * A page that fails to read answers `undefined`, since part of a set must never pass for all of it.
 */
export async function expandSet(
  proposal: Proposal,
  labeling: SetLabeling,
  io: SetIO,
): Promise<SetRow[] | undefined> {
  const locale = proposal.query?.locale;
  const rows: SetRow[] = [];
  for (let page = 1; ; page++) {
    const loaded = await io.page({
      where: proposal.where,
      select: ['UUID', ...labeling.labelFields],
      ...(isUndefined(locale) ? {} : { locale }),
      page,
      perPage: PER_PAGE,
    });
    if (isUndefined(loaded)) return undefined;
    const records = loaded.records.filter((record) => isString(record.UUID));
    const mine = await io.verdict(records.map((record) => record.UUID as string));
    for (const record of records) {
      const UUID = record.UUID as string;
      const label = renderLabel(record, labeling.labelFields, labeling.labelTemplate);
      rows.push({ UUID, label, mine: mine.has(UUID) });
    }
    if (page >= loaded.lastPage) break;
  }
  return rows;
}

/**
 * Puts a wire `where` into words, one clause per leaf, joined the way the filter joins them.
 * A filter the grammar does not parse answers `''`.
 *
 * @example
 * ```ts
 * describeWhere({ level: { lessThan: 10 }, rarity: 'epic' }, words)
 * // -> 'Level is less than 10 and Rarity is epic'
 * ```
 */
export function describeWhere(where: unknown, words: FilterWords): string {
  const parsed = parseCondition(where);
  return parsed.ok ? describeNode(parsed.node, words) : '';
}

/**
 * The words of one node of the condition tree.
 */
function describeNode(node: ConditionNode, words: FilterWords): string {
  if (node.kind === 'and' || node.kind === 'or') {
    return node.nodes
      .map((child) => describeNode(child, words))
      .reduce((a, b) => words.t(`ai.dashboard.filter.${node.kind}`, { a, b }));
  }
  const field = words.field(node.path.join('.'));
  if (node.kind === 'has') {
    if (node.condition === null) {
      return words.t(node.negated ? 'ai.dashboard.filter.hasNone' : 'ai.dashboard.filter.hasAny', {
        field,
      });
    }
    return words.t(node.negated ? 'ai.dashboard.filter.hasNot' : 'ai.dashboard.filter.has', {
      field,
      condition: describeNode(node.condition, words),
    });
  }
  if (node.kind === 'empty') {
    return words.t(node.negated ? 'ai.dashboard.filter.notEmpty' : 'ai.dashboard.filter.empty', {
      field,
    });
  }
  const key = `ai.dashboard.filter.${node.negated ? 'not.' : ''}${node.op}`;
  return node.op === 'isNull'
    ? words.t(key, { field })
    : words.t(key, { field, value: formatValue(node.value) });
}

/**
 * A filter value as the clause shows it: a list joined by commas, anything else as text.
 */
function formatValue(value: unknown): string {
  return isArray(value) ? value.map(String).join(', ') : String(value);
}
