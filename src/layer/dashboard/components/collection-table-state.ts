import {
  type ConditionObject,
  isEmpty,
  isPlainObject,
  isPositiveInteger,
  isString,
  isUndefined,
  parseSearchParams,
  type SearchParamValue,
  stringifySearchParams,
  toArray,
} from 'ohne/utils';

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
   * The CSS minimum width; `'16rem'` unless the URL spec sets a `width`.
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
 * How a field sorts: `text` and letter icons for text columns, `numeric` for the rest.
 * `false` covers the composite kinds no single column backs.
 */
function sortableOf(field: TableFieldMeta): false | 'text' | 'numeric' {
  if (field.kind !== 'column' && field.kind !== 'record') return false;
  return field.logicalType === 'text' ? 'text' : 'numeric';
}

/**
 * Resolves the table's columns.
 *
 * Without a `spec`, the first four declared readable fields become columns, `_updatedAt` closing the set.
 * A `spec` lists columns as `name|width|minWidth` entries.
 * An unknown name warns and is skipped, and a missing width keeps the `16rem` minimum.
 * An empty result falls back to the `UUID` column alone.
 *
 * @example
 * ```ts
 * resolveTableColumns(fields)                         // -> first 4 declared fields + _updatedAt
 * resolveTableColumns(fields, ['title|20rem', 'age']) // -> title at 20rem, age at min 16rem
 * ```
 */
export function resolveTableColumns(
  fields: readonly TableFieldMeta[],
  spec?: readonly string[],
): TableColumnSpec[] {
  const columns: TableColumnSpec[] = [];

  if (isUndefined(spec) || isEmpty(spec)) {
    const declared = fields.filter(
      (field) => field.readable && field.name !== 'UUID' && field.name !== '_updatedAt',
    );
    for (const field of declared.slice(0, 4)) {
      columns.push({
        name: field.name,
        label: field.label,
        sortable: sortableOf(field),
        minWidth: '16rem',
      });
    }
    const updatedAt = fields.find((field) => field.name === '_updatedAt');
    if (!isUndefined(updatedAt)) {
      columns.push({
        name: updatedAt.name,
        label: updatedAt.label,
        sortable: 'numeric',
        minWidth: '16rem',
      });
    }
  } else {
    for (const entry of spec) {
      const [name, width, minWidth] = entry.split('|').map((part) => part.trim());
      if (isUndefined(name) || name === '') continue;
      const field = fields.find((candidate) => candidate.name === name);
      if (isUndefined(field)) {
        console.warn(`Unable to resolve field \`${name}\` in the collection table columns.`);
        continue;
      }
      const column: TableColumnSpec = {
        name: field.name,
        label: field.label,
        sortable: sortableOf(field),
      };
      if (!isUndefined(width) && width !== '') column.width = width;
      if (!isUndefined(minWidth) && minWidth !== '') column.minWidth = minWidth;
      else if (isUndefined(column.width)) column.minWidth = '16rem';
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
