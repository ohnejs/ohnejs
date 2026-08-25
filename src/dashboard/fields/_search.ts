import type { Child } from '../render/insert.ts';
import type { DashboardCollection, DashboardField } from '../runtime/meta-types.ts';

import { debounce } from '../../utils/debounce/debounce.ts';
import { isString } from '../../utils/is/is-string.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { h } from '../render/h.ts';
import { api } from '../runtime/api.ts';
import { dashboardMeta } from '../runtime/meta.ts';

/**
 * One searched target row: its `UUID` and the label field's value.
 */
export type SearchRow = Record<string, unknown>;

/**
 * A live search over a relation target's rows, shared by the picker and the links editor.
 */
export interface TargetSearch {
  /**
   * The current results, newest query wins; empty until the first answer.
   */
  rows(): readonly SearchRow[];

  /**
   * Whether any query has answered yet, separating "still loading" from "no matches".
   */
  settled(): boolean;

  /**
   * Schedules a debounced search for `text`; an empty text lists the first rows.
   */
  search(text: string): void;

  /**
   * Loads the unfiltered first rows at once, for the moment the search opens.
   */
  prime(): void;
}

const RESULTS = 8;

/**
 * Creates a `TargetSearch` over `target`, matching and ordering by `label`.
 * Responses are sequence-guarded, so a stale answer never replaces a newer one.
 * The pending debounce dies with the owning scope.
 */
export function createTargetSearch(
  target: DashboardCollection,
  label: DashboardField,
): TargetSearch {
  const results = ref<readonly SearchRow[] | undefined>(undefined);
  let generation = 0;

  const load = async (text: string): Promise<void> => {
    const mine = (generation += 1);
    const body = {
      select: ['UUID', label.name],
      order: [label.name],
      limit: RESULTS,
      ...(text === '' ? {} : { where: { [label.name]: { contains: text } } }),
    };
    try {
      const response = await api(`POST /collections/${target.segment}/query`, {
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        settle();
        return;
      }
      const rows = (await response.json()) as SearchRow[];
      if (generation === mine) results.value = rows;
    } catch {
      settle();
    }
  };
  // A failed first answer settles on an empty list, so a caller's loading state never sticks;
  // once anything answered, the previous results stand.
  const settle = (): void => {
    if (isUndefined(results.value)) results.value = [];
  };

  const scheduled = debounce((text: string) => void load(text), 200);
  onCleanup(() => scheduled.cancel());

  return {
    rows: () => results.value ?? [],
    settled: () => !isUndefined(results.value),
    search: scheduled,
    prime: () => void load(''),
  };
}

/**
 * The relation's target collection, when the discovery read lists it as readable for the user.
 */
export function targetOf(field: DashboardField): DashboardCollection | undefined {
  const target = dashboardMeta()?.collections.find((entry) => entry.name === field.target);
  if (isUndefined(target) || target.operations.read?.allowed !== true) return undefined;
  return target;
}

/**
 * The target's first plain readable text field, the one a search matches and shows.
 */
export function labelFieldOf(target: DashboardCollection): DashboardField | undefined {
  return target.fields.find(
    (field) =>
      field.readable &&
      field.kind === 'column' &&
      field.logicalType === 'text' &&
      field.type !== 'password' &&
      field.name !== 'UUID',
  );
}

/**
 * The row's display text: the label value, or its `UUID` in the mono font when the label is empty.
 */
export function rowLabel(row: SearchRow, labelName: string): Child {
  const value = row[labelName];
  if (isString(value) && value !== '') return value;
  return h('span', { class: 'cell-mono' }, String(row.UUID ?? ''));
}
