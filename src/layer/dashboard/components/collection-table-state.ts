import {
  type ConditionObject,
  isEmpty,
  isNumber,
  isPlainObject,
  isPositiveInteger,
  isString,
  isUndefined,
  parseSearchParams,
  type SearchParamValue,
  stringifySearchParams,
  toArray,
} from 'ohnejs/utils';

const PX_WIDTH = /^[1-9][0-9]*px$/;

// The URL is untrusted and widths land in a style attribute, so only a plain length may pass.
const CSS_WIDTH = /^\d+(\.\d+)?(px|rem|em|ch|vw|vh|vmin|vmax|%)$/;

const DEFAULT_MIN_WIDTH = '256px';

/**
 * The system field names a collection carries beside its declared fields.
 * `_translations` exists on a translatable collection alone.
 */
export const SYSTEM_FIELDS: ReadonlySet<string> = new Set(['UUID', '_updatedAt', '_translations']);

/**
 * The slice of `DashboardField` the column resolver reads.
 * A structural subset, so this module stays free of the browser-only dashboard types.
 */
export interface TableFieldMeta {
  /**
   * The field name, as records carry it.
   */
  name: string;

  /**
   * The display label, resolved in the request's language.
   */
  label: string;

  /**
   * How the field stores and reads; only `column` and `record` back a sortable column.
   */
  kind: string;

  /**
   * The storage primitive of the field's column; `text` picks the letter sort icons.
   */
  logicalType?: string;

  /**
   * Whether reads return the field; write-only fields never become columns.
   */
  readable: boolean;
}

/**
 * One resolved table column: the field it shows and how it sorts and sizes.
 */
export interface TableColumnSpec {
  /**
   * The field name, the column key.
   */
  name: string;

  /**
   * The column header label.
   */
  label: string;

  /**
   * Whether the column sorts, and which sort icons it shows.
   */
  sortable: false | 'text' | 'numeric';

  /**
   * The CSS width from the `columns` URL spec.
   */
  width?: string;

  /**
   * The CSS minimum width; `'256px'` unless the URL spec sets a `width`.
   */
  minWidth?: string;
}

/**
 * The collection table's URL state: everything the query string carries between reloads.
 */
export interface TableURLState {
  /**
   * The one-based page number.
   *
   * @default
   * 1
   */
  page: number;

  /**
   * The ohne order strings, a leading `-` meaning descending.
   */
  order: string[];

  /**
   * The applied filter, in the exact shape the body-query endpoint reads.
   * Absent means no filter.
   */
  where: ConditionObject | undefined;

  /**
   * The `columns` spec, one `name|width|minWidth` entry per column; absent means default columns.
   */
  columns: string[] | undefined;
}

/**
 * One row of the columns editor.
 * A type literal, so the structure's `Record<string, unknown>` item constraint accepts it.
 */
export type TableColumnEdit = {
  /**
   * The structure's reconciliation key. Always equal to `name`.
   */
  $key: string;

  /**
   * The field the column shows.
   */
  name: string;

  /**
   * The column's width: a pixel count when fixed, `null` when automatic.
   * `false` marks a CSS width the editor preserves but does not edit.
   */
  width: number | null | false;

  /**
   * The entry's `width` slot exactly as written, kept so a `false` width survives a round trip.
   */
  rawWidth?: string;

  /**
   * The entry's `minWidth` slot exactly as written.
   */
  rawMinWidth?: string;
};

/**
 * How a field sorts: `text` and letter icons for text columns, `numeric` for the rest.
 * `false` covers the composite kinds no single column backs, and a json column's unordered list.
 */
function sortableOf(field: TableFieldMeta): false | 'text' | 'numeric' {
  if (field.kind !== 'column' && field.kind !== 'record') return false;
  if (field.logicalType === 'json') return false;
  return field.logicalType === 'text' ? 'text' : 'numeric';
}

/**
 * The readable fields a column header can sort by, in declared order.
 */
export function sortableFieldsOf<F extends TableFieldMeta>(fields: readonly F[]): F[] {
  return fields.filter((field) => field.readable && sortableOf(field) !== false);
}

/**
 * The parsed, admissible entries of a `columns` spec, in order.
 * An entry is dropped when it names nothing, an unknown field, an unreadable one, or a repeat.
 * A width slot that is not a plain CSS length or percentage is dropped alone.
 * The URL is the primary source, so none of these can be trusted.
 */
function parseColumnEntries(
  spec: readonly string[],
  fields: readonly TableFieldMeta[],
): { field: TableFieldMeta; width?: string; minWidth?: string }[] {
  const entries: { field: TableFieldMeta; width?: string; minWidth?: string }[] = [];
  const seen = new Set<string>();
  for (const entry of spec) {
    const [name, width, minWidth] = entry.split('|').map((part) => part.trim());
    if (isUndefined(name) || name === '') continue;
    const field = fields.find((candidate) => candidate.name === name);
    if (isUndefined(field)) {
      console.warn(`Unable to resolve field \`${name}\` in the collection table columns.`);
      continue;
    }
    if (!field.readable) {
      console.warn(`Field \`${name}\` is not readable and cannot be a collection table column.`);
      continue;
    }
    if (seen.has(name)) {
      console.warn(`Field \`${name}\` is repeated in the collection table columns.`);
      continue;
    }
    seen.add(name);
    const parsed: { field: TableFieldMeta; width?: string; minWidth?: string } = { field };
    if (!isUndefined(width) && width !== '') {
      if (CSS_WIDTH.test(width)) parsed.width = width;
      else console.warn(`Ignoring invalid width \`${width}\` in the collection table columns.`);
    }
    if (!isUndefined(minWidth) && minWidth !== '') {
      if (CSS_WIDTH.test(minWidth)) parsed.minWidth = minWidth;
      else console.warn(`Ignoring invalid width \`${minWidth}\` in the collection table columns.`);
    }
    entries.push(parsed);
  }
  return entries;
}

/**
 * One serialized `columns` entry: `name`, `width`, and `minWidth` joined with `|`.
 * A `256px` minimum beside no width is the resolver's default, so it serializes away.
 * Trailing empty slots drop, keeping a bare entry bare.
 */
function columnEntry(name: string, width?: string, minWidth?: string): string {
  const minimum = isUndefined(width) && minWidth === DEFAULT_MIN_WIDTH ? undefined : minWidth;
  const parts = [name, width ?? '', minimum ?? ''];
  while (parts.length > 1 && parts.at(-1) === '') parts.pop();
  return parts.join('|');
}

/**
 * Resolves the table's columns.
 *
 * Without a `spec`, the first four declared readable fields become columns, `_updatedAt` closing the set.
 * A translatable collection takes three declared fields, then `_translations`, then `_updatedAt`.
 * A `spec` lists columns as `name|width|minWidth` entries.
 * An unknown, unreadable, or repeated name warns and is skipped.
 * A missing width keeps the `256px` minimum.
 * An empty result falls back to the `UUID` column alone.
 *
 * @example
 * ```ts
 * resolveTableColumns(fields)                         // -> first 4 declared fields + _updatedAt
 * resolveTableColumns(translatable)                   // -> first 3 + _translations + _updatedAt
 * resolveTableColumns(fields, ['title|320px', 'age']) // -> title at 320px, age at min 256px
 * ```
 */
export function resolveTableColumns(
  fields: readonly TableFieldMeta[],
  spec?: readonly string[],
): TableColumnSpec[] {
  const columns: TableColumnSpec[] = [];

  if (isUndefined(spec) || isEmpty(spec)) {
    const auto = (
      field: TableFieldMeta,
      sortable: TableColumnSpec['sortable'],
    ): TableColumnSpec => ({
      name: field.name,
      label: field.label,
      sortable,
      minWidth: DEFAULT_MIN_WIDTH,
    });
    const declared = fields.filter((field) => field.readable && !SYSTEM_FIELDS.has(field.name));
    const translations = fields.find((field) => field.name === '_translations');
    for (const field of declared.slice(0, isUndefined(translations) ? 4 : 3)) {
      columns.push(auto(field, sortableOf(field)));
    }
    if (!isUndefined(translations)) columns.push(auto(translations, false));
    const updatedAt = fields.find((field) => field.name === '_updatedAt');
    if (!isUndefined(updatedAt)) columns.push(auto(updatedAt, 'numeric'));
  } else {
    for (const { field, width, minWidth } of parseColumnEntries(spec, fields)) {
      const column: TableColumnSpec = {
        name: field.name,
        label: field.label,
        sortable: sortableOf(field),
      };
      if (!isUndefined(width)) column.width = width;
      if (!isUndefined(minWidth)) column.minWidth = minWidth;
      else if (isUndefined(column.width)) column.minWidth = DEFAULT_MIN_WIDTH;
      columns.push(column);
    }
  }

  if (columns.length === 0) {
    const uuid = fields.find((field) => field.name === 'UUID');
    if (!isUndefined(uuid)) {
      columns.push({ name: uuid.name, label: uuid.label, sortable: sortableOf(uuid) });
    }
  }

  return columns;
}

/**
 * Writes resolved columns back into `columns` spec entries, the resolver's exact inverse.
 * Every slot serializes, so a `minWidth`-only column survives a round trip unchanged.
 *
 * @example
 * ```ts
 * serializeTableColumns([{ name: 'title', label: 'Title', sortable: 'text', minWidth: '256px' }])
 * // -> ['title']
 *
 * serializeTableColumns([{ name: 'title', label: 'Title', sortable: 'text', minWidth: '384px' }])
 * // -> ['title||384px']
 * ```
 */
export function serializeTableColumns(columns: readonly TableColumnSpec[]): string[] {
  return columns.map((column) => columnEntry(column.name, column.width, column.minWidth));
}

/**
 * The columns editor's rows, rebuilt from a `columns` spec.
 * Inadmissible entries drop as in `resolveTableColumns`.
 * A width decodes to its pixel count when it is the entry's only sizing, and to `null` when absent.
 * Any other combination decodes to `false`, so the entry round-trips through the raw slots untouched.
 *
 * @example
 * ```ts
 * editableTableColumns(['title|256px'], fields)
 * // -> [{ $key: 'title', name: 'title', width: 256, rawWidth: '256px' }]
 *
 * editableTableColumns(['title||384px'], fields)
 * // -> [{ $key: 'title', name: 'title', width: null, rawMinWidth: '384px' }]
 * ```
 */
export function editableTableColumns(
  spec: readonly string[],
  fields: readonly TableFieldMeta[],
): TableColumnEdit[] {
  return parseColumnEntries(spec, fields).map(({ field, width, minWidth }) => {
    const fixed = !isUndefined(width) && isUndefined(minWidth) && PX_WIDTH.test(width);
    const edit: TableColumnEdit = {
      $key: field.name,
      name: field.name,
      width: isUndefined(width) ? null : fixed ? Number.parseInt(width, 10) : false,
    };
    if (!isUndefined(width)) edit.rawWidth = width;
    if (!isUndefined(minWidth)) edit.rawMinWidth = minWidth;
    return edit;
  });
}

/**
 * Writes the editor's rows back into `columns` spec entries, the inverse of `editableTableColumns`.
 * A fixed width emits `${n}px` and no minimum; an automatic one keeps only its written minimum.
 * A preserved CSS width emits both slots exactly as written.
 *
 * @example
 * ```ts
 * serializeTableColumnEdits([{ $key: 'title', name: 'title', width: 256 }])  // -> ['title|256px']
 * serializeTableColumnEdits([{ $key: 'title', name: 'title', width: null }]) // -> ['title']
 * ```
 */
export function serializeTableColumnEdits(items: readonly TableColumnEdit[]): string[] {
  return items.map((item) =>
    isNumber(item.width)
      ? columnEntry(item.name, `${item.width}px`)
      : item.width === false
        ? columnEntry(item.name, item.rawWidth, item.rawMinWidth)
        : columnEntry(item.name, undefined, item.rawMinWidth ?? DEFAULT_MIN_WIDTH),
  );
}

/**
 * The non-empty strings a parsed param carries, as a list.
 * A lone value reads as a one-entry list, so `order=title` and `order=[title]` agree.
 */
function stringList(value: SearchParamValue | undefined): string[] {
  return toArray<SearchParamValue | undefined>(value).filter(
    (entry): entry is string => isString(entry) && entry !== '',
  );
}

/**
 * Reads the table state out of a query string.
 * A missing or invalid `page` reads as `1`, a missing or empty `order` as `defaultOrder`.
 * A `where` that is not an object reads as no filter.
 *
 * @example
 * ```ts
 * parseTableState('', ['-_updatedAt'])
 * // -> { page: 1, order: ['-_updatedAt'], where: undefined, columns: undefined }
 *
 * parseTableState('?page=3&order=[-title]&where={age:2}', ['-_updatedAt'])
 * // -> { page: 3, order: ['-title'], where: { age: 2 }, columns: undefined }
 * ```
 */
export function parseTableState(search: string, defaultOrder: readonly string[]): TableURLState {
  const params = parseSearchParams(search);

  const page = isPositiveInteger(params.page) ? params.page : 1;

  const parsedOrder = stringList(params.order);
  const order = parsedOrder.length === 0 ? [...defaultOrder] : parsedOrder;

  const where = isPlainObject<ConditionObject>(params.where) ? params.where : undefined;

  const columns = isUndefined(params.columns) ? undefined : stringList(params.columns);

  return { page, order, where, columns };
}

/**
 * Writes the table state into a query string, without the leading `?`.
 * Params carrying their default - page `1`, the default order, no filter - are omitted.
 * The default view therefore keeps a bare URL.
 * Params this module does not own, like `edit`, carry over from `search` untouched.
 *
 * @example
 * ```ts
 * serializeTableState({ page: 1, order: ['-_updatedAt'], where: undefined, columns: undefined }, ['-_updatedAt'])
 * // -> ''
 *
 * serializeTableState({ page: 2, order: ['title'], where: { age: 2 }, columns: undefined }, ['-_updatedAt'])
 * // -> 'page=2&order=[title]&where={age:2}'
 * ```
 */
export function serializeTableState(
  state: TableURLState,
  defaultOrder: readonly string[],
  search = '',
): string {
  const ordered = state.order.length > 0 && state.order.join(',') !== defaultOrder.join(',');
  return stringifySearchParams({
    ...parseSearchParams(search),
    page: state.page > 1 ? state.page : undefined,
    order: ordered ? state.order : undefined,
    where: state.where as SearchParamValue | undefined,
    columns: state.columns,
  });
}

/**
 * The header sort a list of order strings shows: its first entry, split into column and direction.
 *
 * @example
 * ```ts
 * sortFromOrder(['-title', 'age']) // -> { column: 'title', direction: 'desc' }
 * sortFromOrder(['age'])           // -> { column: 'age', direction: 'asc' }
 * sortFromOrder([])                // -> null
 * ```
 */
export function sortFromOrder(
  order: readonly string[],
): { column: string; direction: 'asc' | 'desc' } | null {
  const first = order[0];
  if (isUndefined(first) || first === '' || first === '-') return null;
  return first.startsWith('-')
    ? { column: first.slice(1), direction: 'desc' }
    : { column: first, direction: 'asc' };
}

/**
 * The ordered selection after a selection-map write.
 * Entries of `previous` still selected keep their order; newly selected keys append in map order.
 * The record picker maintains pick order with this, so applying never reshuffles linked records.
 *
 * @example
 * ```ts
 * orderedSelection(['a', 'b'], { a: true, b: true, c: true }) // -> ['a', 'b', 'c']
 * orderedSelection(['a', 'b'], { b: true })                   // -> ['b']
 * ```
 */
export function orderedSelection(
  previous: readonly string[],
  selected: Readonly<Record<number | string, boolean>>,
): string[] {
  const kept = previous.filter((key) => selected[key] === true);
  const seen = new Set(kept);
  const added = Object.keys(selected).filter((key) => selected[key] === true && !seen.has(key));
  return [...kept, ...added];
}

/**
 * A search string without the `edit` deep-link param, in `location.search` form.
 * The per-segment memory stores this, so returning to a collection never reopens an edit popup.
 *
 * @example
 * ```ts
 * stripEditParam('?page=2&edit=[title,abc]') // -> '?page=2'
 * stripEditParam('?edit=[title,abc]')        // -> ''
 * ```
 */
export function stripEditParam(search: string): string {
  const query = stringifySearchParams({ ...parseSearchParams(search), edit: undefined });
  return query === '' ? '' : `?${query}`;
}
