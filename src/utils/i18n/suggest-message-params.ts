import type {
  MessageAST,
  MessageNode,
  MessagePluralNode,
  MessageSelectNode,
} from './message-ast.ts';

import { isDate } from '../is/is-date.ts';
import { isNull } from '../is/is-null.ts';
import { isNumber } from '../is/is-number.ts';
import { parseMessage } from './parse-message.ts';

/**
 * Options accepted by `suggestMessageParams` and `suggestMessageParamsAST`.
 */
export interface SuggestMessageParamsOptions {
  /**
   * BCP 47 language tag used to sample `plural` and `selectordinal` keyword cases.
   * Drives `Intl.PluralRules` when picking a representative number per category.
   *
   * @default
   * 'en'
   */
  locale?: string;
}

/**
 * One preview row produced by `suggestMessageParams`.
 * `params` is the bag to feed `formatMessage` (or `formatMessageAST`).
 * `label` names the variation: `'default'`, `'count: one'`, `'gender: female'`, ...
 */
export interface MessageParamSuggestion {
  /**
   * Parameter values for this preview row.
   * Keys are argument names from the template; values are typed samples.
   */
  readonly params: Record<string, string | number | Date>;

  /**
   * Human label describing the variation this row demonstrates.
   * The baseline row is labelled `'default'`.
   */
  readonly label: string;
}

type SampleValue = string | number | Date;

type PathStep = {
  name: string;
  value: SampleValue;
};

type ArgVariation = {
  value: SampleValue;
  label: string;
  path: readonly PathStep[];
};

type ArgEntry = {
  defaultValue: SampleValue;
  variations: ArgVariation[];
};

const SAMPLE_DATE = new Date(Date.UTC(2024, 5, 17, 14, 30, 45));
const SAMPLE_DEFAULT_NUMBER = 1234.5;
const PROBE_SEQUENCE: readonly number[] = [0, 1, 2, 3, 4, 5, 6, 11, 21, 101, 1.5];

/**
 * Parses `template` and suggests example `params` rows so a translator can preview every branch.
 * Convenience over `parseMessage` + `suggestMessageParamsAST`; parses on every call.
 * Throws `MessageSyntaxError` on a malformed template.
 *
 * @example
 * ```ts
 * suggestMessageParams('{n, plural, one {# item} other {# items}}')
 * // -> [
 * //      { params: { n: 1 }, label: 'default' },
 * //      { params: { n: 0 }, label: 'n: other' },
 * //    ]
 * ```
 */
export function suggestMessageParams(
  template: string,
  options?: SuggestMessageParamsOptions,
): readonly MessageParamSuggestion[] {
  return suggestMessageParamsAST(parseMessage(template), options);
}

/**
 * Walks a parsed `MessageAST` and returns one preview row per branch worth exercising.
 *
 * Strategy: vary one argument at a time, hold all other arguments at their first sample.
 * `Intl.PluralRules` samples `plural` and `selectordinal` keyword cases for the active `locale`.
 * `=N` exacts are taken literally.
 * Locale categories not declared in the AST are still emitted so the `other` fallback is visible.
 * Nested arguments inherit routing values so the inner variation is reached at render time.
 *
 * Deterministic: a fixed sample date, fixed probe sequence, no `Date.now()` use.
 *
 * @example
 * ```ts
 * const ast = parseMessage('{gender, select, female {she} male {he} other {they}} arrived')
 * suggestMessageParamsAST(ast)
 * // -> [
 * //      { params: { gender: 'female' }, label: 'default' },
 * //      { params: { gender: 'male' },   label: 'gender: male' },
 * //      { params: { gender: 'other' },  label: 'gender: other' },
 * //    ]
 * ```
 */
export function suggestMessageParamsAST(
  ast: MessageAST,
  options?: SuggestMessageParamsOptions,
): readonly MessageParamSuggestion[] {
  const locale = options?.locale ?? 'en';
  const collected = new Map<string, ArgEntry>();
  walk(ast, [], collected, locale);

  const defaults: Record<string, SampleValue> = {};
  for (const [name, entry] of collected) defaults[name] = entry.defaultValue;

  const suggestions: MessageParamSuggestion[] = [{ params: { ...defaults }, label: 'default' }];
  const seen = new Set<string>([stableKey(defaults)]);

  for (const [name, entry] of collected) {
    for (const v of entry.variations) {
      const params: Record<string, SampleValue> = { ...defaults };
      for (const step of v.path) params[step.name] = step.value;
      params[name] = v.value;
      const key = stableKey(params);
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push({ params, label: v.label });
    }
  }

  return suggestions;
}

function walk(
  nodes: MessageAST,
  path: readonly PathStep[],
  entries: Map<string, ArgEntry>,
  locale: string,
): void {
  for (const node of nodes) walkNode(node, path, entries, locale);
}

function walkNode(
  node: MessageNode,
  path: readonly PathStep[],
  entries: Map<string, ArgEntry>,
  locale: string,
): void {
  switch (node.kind) {
    case 'literal':
    case 'pound':
      return;

    case 'argument':
      ensureEntry(entries, node.name, node.name);
      return;

    case 'number':
      ensureEntry(entries, node.name, numberSample(node.style));
      return;

    case 'date':
    case 'time':
      ensureEntry(entries, node.name, SAMPLE_DATE);
      return;

    case 'plural':
      visitPlural(node, path, entries, locale);
      return;

    case 'select':
      visitSelect(node, path, entries, locale);
      return;
  }
}

function visitPlural(
  node: MessagePluralNode,
  path: readonly PathStep[],
  entries: Map<string, ArgEntry>,
  locale: string,
): void {
  const exacts = new Set<number>();
  for (const c of node.cases) if (!isNull(c.exact)) exacts.add(c.exact);

  const rules = new Intl.PluralRules(locale, {
    type: node.ordinal ? 'ordinal' : 'cardinal',
  });

  const declaredKeywords = new Set<string>();
  for (const c of node.cases) if (isNull(c.exact)) declaredKeywords.add(c.keyword);

  const samples: { value: number; label: string }[] = [];
  const seenValues = new Set<number>();
  const add = (value: number, label: string): void => {
    if (seenValues.has(value)) return;
    seenValues.add(value);
    samples.push({ value, label });
  };

  for (const c of node.cases) {
    if (!isNull(c.exact)) add(c.exact, `${node.name}: ${c.keyword}`);
  }

  for (const c of node.cases) {
    if (isNull(c.exact)) {
      const raw = probeForKeyword(c.keyword, rules, exacts, node.offset);
      if (!isNull(raw)) add(raw, `${node.name}: ${c.keyword}`);
    }
  }

  for (const kw of rules.resolvedOptions().pluralCategories) {
    if (declaredKeywords.has(kw)) continue;
    const raw = probeForKeyword(kw, rules, exacts, node.offset);
    if (!isNull(raw)) add(raw, `${node.name}: ${kw} (locale-only)`);
  }

  if (node.offset !== 0) {
    for (const raw of [node.offset, node.offset + 1]) {
      if (exacts.has(raw)) continue;
      add(raw, `${node.name}: ${raw} (boundary)`);
    }
  }

  const fallbackDefault = samples[0]?.value ?? 0;
  const entry = ensureEntry(entries, node.name, fallbackDefault);
  for (const s of samples) entry.variations.push({ value: s.value, label: s.label, path });

  for (const c of node.cases) {
    const routing = isNull(c.exact)
      ? probeForKeyword(c.keyword, rules, exacts, node.offset)
      : c.exact;
    if (isNull(routing)) continue;
    walk(c.body, [...path, { name: node.name, value: routing }], entries, locale);
  }
}

function visitSelect(
  node: MessageSelectNode,
  path: readonly PathStep[],
  entries: Map<string, ArgEntry>,
  locale: string,
): void {
  const fallbackDefault = node.cases[0]?.keyword ?? 'other';
  const entry = ensureEntry(entries, node.name, fallbackDefault);
  for (const c of node.cases) {
    entry.variations.push({ value: c.keyword, label: `${node.name}: ${c.keyword}`, path });
  }

  for (const c of node.cases) {
    walk(c.body, [...path, { name: node.name, value: c.keyword }], entries, locale);
  }
}

function ensureEntry(
  entries: Map<string, ArgEntry>,
  name: string,
  initialDefault: SampleValue,
): ArgEntry {
  const existing = entries.get(name);
  if (existing) return existing;
  const created: ArgEntry = { defaultValue: initialDefault, variations: [] };
  entries.set(name, created);
  return created;
}

function probeForKeyword(
  keyword: string,
  rules: Intl.PluralRules,
  exacts: ReadonlySet<number>,
  offset: number,
): number | null {
  for (const adjusted of PROBE_SEQUENCE) {
    const raw = adjusted + offset;
    if (exacts.has(raw)) continue;
    if (rules.select(adjusted) === keyword) return raw;
  }
  return null;
}

function numberSample(style: string | null): number {
  if (isNull(style)) return SAMPLE_DEFAULT_NUMBER;
  if (style === 'integer') return 1234;
  if (style === 'percent') return 0.42;
  if (style === 'currency') return SAMPLE_DEFAULT_NUMBER;
  if (style.startsWith('::')) {
    const skeleton = style.slice(2);
    if (/(^|\s)percent(\s|$)/.test(skeleton)) return 0.42;
    if (/(^|\s)(compact-short|compact-long|scientific|engineering)(\s|$)/.test(skeleton)) {
      return 12345;
    }
  }
  return SAMPLE_DEFAULT_NUMBER;
}

function stableKey(params: Record<string, SampleValue>): string {
  const keys = Object.keys(params).sort();
  let out = '';
  for (const k of keys) {
    const v = params[k];
    out += `${k}=`;
    if (isDate(v)) out += `D${v.getTime()}`;
    else if (isNumber(v)) out += `N${v}`;
    else out += `S${v}`;
    out += '|';
  }
  return out;
}
