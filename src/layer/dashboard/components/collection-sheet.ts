import {
  api,
  type Child,
  css,
  type DashboardCollection,
  type DashboardField,
  h,
  sheet,
  type SheetColumn,
  type SheetModel,
  type SheetPage,
  useDashboardLanguage,
  useT,
} from 'ohne/dashboard';
import {
  effect,
  isArray,
  isNullish,
  isNumber,
  isPlainObject,
  isString,
  isUndefined,
  ref,
} from 'ohne/utils';

/**
 * One record row, as the collections API answers it.
 */
type SheetRecord = Record<string, unknown>;

const PER_PAGE = 50;

const dateFormats = new Map<string, Intl.DateTimeFormat>();

css`
  .collection-sheet-count {
    display: block;
    margin-bottom: 10px;
  }

  .cell-dim {
    color: var(--dim);
  }

  .cell-mono {
    font-family: var(--mono);
    font-size: 12px;
  }
`;

/**
 * A collection's records in the sheet, fed from the body-query endpoint page by page.
 * The record count line sits above; ordering is newest change first.
 * The `entry` accessor is reactive: a different collection or refreshed discovery data reloads.
 */
export function collectionSheet(entry: () => DashboardCollection | undefined): Child {
  const t = useT();
  const pageNumber = ref(1);
  const page = ref<SheetPage<SheetRecord> | undefined>(undefined);
  let generation = 0;

  effect(() => {
    const current = entry();
    const number = pageNumber.value;
    if (isUndefined(current)) return;
    const mine = (generation += 1);
    page.value = undefined;
    void loadPage(current.segment, number).then((loaded) => {
      if (generation === mine && !isUndefined(loaded)) page.value = loaded;
    });
  });

  const fields = (): DashboardField[] => (entry()?.fields ?? []).filter((field) => field.readable);

  const model: SheetModel<SheetRecord> = {
    columns: () =>
      fields().map(
        (field): SheetColumn => ({
          key: field.name,
          label: field.label,
          numeric: numericColumn(field),
        }),
      ),
    page: () => page.value,
    rowKey: (row, index) => String(row.UUID ?? index),
    cell: (row, column) => () =>
      formatCell(
        fields().find((field) => field.name === column.key),
        row()[column.key],
        useDashboardLanguage().value,
      ),
    setPage: (number) => {
      pageNumber.value = number;
    },
  };

  return h(
    'div',
    null,
    h('span', { class: 'collection-sheet-count ohne-caps' }, () => {
      const current = page.value;
      return isUndefined(current) ? '' : t('dashboard.records', { count: current.total });
    }),
    sheet(model),
  );
}

/**
 * Loads one page through `POST /collections/[segment]/query`; a failure resolves `undefined`.
 */
async function loadPage(
  segment: string,
  page: number,
): Promise<SheetPage<SheetRecord> | undefined> {
  try {
    const response = await api(`POST /collections/${segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ page, perPage: PER_PAGE, order: ['-_updatedAt'] }),
    });
    if (!response.ok) return undefined;
    return (await response.json()) as SheetPage<SheetRecord>;
  } catch {
    return undefined;
  }
}

/**
 * Whether the column right-aligns: integer and real columns, except the date-rendered `_updatedAt`.
 */
function numericColumn(field: DashboardField): boolean {
  if (field.name === '_updatedAt') return false;
  return field.logicalType === 'integer' || field.logicalType === 'real';
}

/**
 * One cell's display value, keyed off the field's kind and storage primitive.
 * Relations show their identity, lists their length, composites a dim mark; `null` reads as `·`.
 */
function formatCell(field: DashboardField | undefined, value: unknown, language: string): Child {
  if (isUndefined(field)) return null;
  if (isNullish(value)) return dim('·');
  if (field.name === '_updatedAt' && isNumber(value)) return dateFormat(language).format(value);
  if (field.kind === 'record') return h('span', { class: 'cell-mono' }, String(value));
  if (field.kind === 'records' || field.kind === 'childMany' || field.kind === 'blocks') {
    return dim(`[${isArray(value) ? value.length : 0}]`);
  }
  if (field.kind === 'childOne') return dim('{…}');
  if (field.logicalType === 'boolean') return value === true ? '✓' : '';
  if (isArray(value)) return value.every(isString) ? value.join(', ') : dim(`[${value.length}]`);
  if (isPlainObject(value)) return dim('{…}');
  return String(value as string | number);
}

/**
 * A dim placeholder mark.
 */
function dim(text: string): Child {
  return h('span', { class: 'cell-dim' }, text);
}

/**
 * The memoized date formatter for `language`.
 */
function dateFormat(language: string): Intl.DateTimeFormat {
  let format = dateFormats.get(language);
  if (isUndefined(format)) {
    format = new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' });
    dateFormats.set(language, format);
  }
  return format;
}
