import {
  api,
  attachTooltip,
  button,
  card,
  type Child,
  css,
  type DashboardCollection,
  type DashboardMeta,
  dashboardMeta,
  each,
  fallbackLabel,
  h,
  icon,
  joinLabel,
  useDashboardLanguage,
  useT,
  when,
} from 'ohne/dashboard';
import {
  computed,
  effect,
  first,
  isEmpty,
  isNumber,
  isString,
  isUndefined,
  onCleanup,
  ref,
  untracked,
} from 'ohne/utils';

import type { OverviewSearch } from '../pages/overview.ts';

/**
 * One recently updated record, flattened for the list row.
 */
interface RecentEdit {
  collectionName: string;
  collectionLabel: string;
  uuid: string;
  label: string;
  updatedAt: number;
  editURL: string;
}

/**
 * One collection's cursor into the merged feed.
 * `rows` buffers the records the feed has fetched but not emitted, newest first.
 */
interface Bucket {
  collection: DashboardCollection;
  rows: RecentEdit[];
  offset: number;
  done: boolean;
}

const PAGE_SIZE = 20;

const UNIT_STEPS: readonly [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

const timeFormats = new Map<string, Intl.RelativeTimeFormat>();

css`
  .o-overview-recent {
    --ohne-padding-header: 0.625rem 0.75rem;
    --ohne-padding-body: 0;
  }

  .o-overview-recent-header {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .o-overview-recent-header svg {
    color: hsl(var(--ohne-muted-foreground));
    font-size: 1rem;
  }

  .o-overview-recent-empty {
    padding: 1.5rem 0.75rem;
    text-align: center;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
  }

  .o-overview-recent-list {
    display: flex;
    flex-direction: column;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .o-overview-recent-row {
    position: relative;
    display: flex;
    gap: 0.5rem;
    align-items: center;
    padding: 0.5rem 0.75rem;
    border-bottom-width: 1px;
    font-size: 0.875rem;
  }

  .o-overview-recent-row:last-child {
    border-bottom-width: 0;
  }

  .o-overview-recent-row:hover {
    background-color: hsl(var(--ohne-muted) / 0.4);
  }

  .o-overview-recent-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    color: hsl(var(--ohne-foreground));
    text-decoration: none;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .o-overview-recent-label::after {
    content: '';
    position: absolute;
    inset: 0;
  }

  .o-overview-recent-label:focus-visible {
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
  }

  .o-overview-recent-label:focus-visible::after {
    box-shadow: inset 0 0 0 0.125rem hsl(var(--ohne-ring));
  }

  .o-overview-recent-time {
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .o-overview-recent-more {
    display: flex;
    justify-content: center;
    /* defeats the card body's stacking margin */
    margin-top: 0;
    padding: 0.375rem;
    border-top-width: 1px;
  }
`;

/**
 * The Recent edits widget.
 * The most recently updated records across every readable collection.
 * Each row links to its record page, with a relative time and a label-plus-collection tooltip.
 * Each readable collection answers the body-query `POST` ordered by `-_updatedAt`.
 * The collections merge newest first, one page at a time.
 * `Load more` extends the feed and hides once every collection has run out.
 * The shared `search` filters the rows; while searching, an empty card hides.
 * The page passes the search state in.
 */
export function overviewRecentEdits(search: OverviewSearch): Child {
  const t = useT();
  const entries = ref<RecentEdit[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const exhausted = ref(false);
  let buckets: Bucket[] = [];
  let started = false;

  const loadMore = async (): Promise<void> => {
    if (loading.value || exhausted.value) return;
    loading.value = true;
    const page = await takePage(buckets);
    entries.value = [...entries.value, ...page];
    exhausted.value = isDrained(buckets);
    loading.value = false;
    loaded.value = true;
  };

  effect(() => {
    const meta = dashboardMeta();
    if (isUndefined(meta) || started) return;
    started = true;
    buckets = bucketsOf(meta);
    void untracked(loadMore);
  });

  const filtered = computed(() =>
    entries.value.filter((entry) =>
      search.matches(entry.label, entry.collectionLabel, entry.collectionName),
    ),
  );

  effect(() => search.registerCount('overview-recent-edits', filtered.value.length));
  onCleanup(() => search.unregisterCount('overview-recent-edits'));

  return when(
    () => loaded.value && (!isEmpty(filtered.value) || !search.active()),
    () => {
      const el = card(
        [
          when(
            () => isEmpty(filtered.value),
            () =>
              h(
                'div',
                { class: 'o-overview-recent-empty' },
                h('span', null, () => t('dashboard.table.noData')),
              ),
            () =>
              h(
                'ul',
                { class: 'o-overview-recent-list' },
                each(
                  () => filtered.value,
                  (entry) => `${entry.collectionName}:${entry.uuid}`,
                  (entry) => recentRow(entry),
                ),
              ),
          ),
          when(
            () => !exhausted.value,
            () =>
              h(
                'div',
                { class: 'o-overview-recent-more' },
                button(
                  h('span', null, () => t('dashboard.overview.loadMore')),
                  {
                    size: -2,
                    variant: 'ghost',
                    disabled: () => loading.value,
                    onClick: () => void loadMore(),
                  },
                ),
              ),
          ),
        ],
        {
          header: h(
            'div',
            { class: 'o-overview-recent-header' },
            icon('history'),
            h('span', null, () => t('dashboard.overview.recentEdits')),
          ),
        },
      );
      el.classList.add('o-overview-recent');
      return el;
    },
  );
}

/**
 * One list row: the record link stretched over the row, and the relative time with its tooltip.
 */
function recentRow(entry: () => RecentEdit): Child {
  const time = h('span', { class: 'o-overview-recent-time' }, () =>
    relativeTime(entry().updatedAt, useDashboardLanguage().value),
  );
  onCleanup(attachTooltip(time, () => `${entry().label} - ${entry().collectionLabel}`));
  return h(
    'li',
    { class: 'o-overview-recent-row' },
    h(
      'a',
      {
        class: 'o-overview-recent-label ohne-raw',
        href: () => entry().editURL,
        title: () => entry().label,
      },
      () => entry().label,
    ),
    time,
  );
}

/**
 * One cursor per readable collection, each starting empty at offset zero.
 */
function bucketsOf(meta: DashboardMeta): Bucket[] {
  const buckets: Bucket[] = [];
  for (const collection of meta.collections) {
    if (collection.operations.read?.allowed !== true) continue;
    buckets.push({ collection, rows: [], offset: 0, done: false });
  }
  return buckets;
}

/**
 * The feed's next page, newest first, shorter than `PAGE_SIZE` once the collections run out.
 * Every unfinished bucket holds a buffered row before the merge picks one, so the pick is the true newest.
 */
async function takePage(buckets: Bucket[]): Promise<RecentEdit[]> {
  const page: RecentEdit[] = [];
  while (page.length < PAGE_SIZE) {
    await Promise.all(buckets.filter(isHungry).map(fillBucket));
    const next = takeNewest(buckets);
    if (isUndefined(next)) break;
    page.push(next);
  }
  return page;
}

/**
 * Whether `bucket` must fetch before the merge can weigh it.
 */
function isHungry(bucket: Bucket): boolean {
  return !bucket.done && isEmpty(bucket.rows);
}

/**
 * Whether the feed has emitted every record `buckets` can answer.
 */
function isDrained(buckets: Bucket[]): boolean {
  return buckets.every((bucket) => bucket.done && isEmpty(bucket.rows));
}

/**
 * Removes and answers the newest buffered row, `undefined` once every buffer is empty.
 */
function takeNewest(buckets: Bucket[]): RecentEdit | undefined {
  let newest: Bucket | undefined;
  let newestAt = -Infinity;
  for (const bucket of buckets) {
    const head = first(bucket.rows);
    if (isUndefined(head) || head.updatedAt <= newestAt) continue;
    newest = bucket;
    newestAt = head.updatedAt;
  }
  return newest?.rows.shift();
}

/**
 * Appends `bucket`'s next page to its buffer through the body-query endpoint.
 * It asks for one row past the page, so only a full answer proves the collection holds more.
 * A short answer ends the bucket; a failure ends it too, so a broken collection drops out of the feed.
 * A record without a label value shows `#` plus its `UUID`'s first eight characters.
 */
async function fillBucket(bucket: Bucket): Promise<void> {
  const select = ['UUID', '_updatedAt', ...bucket.collection.labelFields];
  const limit = PAGE_SIZE + 1;
  try {
    const response = await api(`POST /collections/${bucket.collection.segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ select, order: ['-_updatedAt'], limit, offset: bucket.offset }),
    });
    if (!response.ok) {
      bucket.done = true;
      return;
    }
    const rows = (await response.json()) as Record<string, unknown>[];
    bucket.offset += rows.length;
    bucket.done = rows.length < limit;
    for (const row of rows) {
      const uuid = row.UUID;
      const updatedAt = row._updatedAt;
      if (!isString(uuid) || !isNumber(updatedAt)) continue;
      const label = joinLabel(row, bucket.collection.labelFields);
      bucket.rows.push({
        collectionName: bucket.collection.name,
        collectionLabel: bucket.collection.label,
        uuid,
        label: label !== '' ? label : fallbackLabel(uuid),
        updatedAt,
        editURL: `/collections/${bucket.collection.segment}/${uuid}`,
      });
    }
  } catch {
    bucket.done = true;
  }
}

/**
 * The elapsed time in words, formatted through `Intl`.
 */
function relativeTime(timestamp: number, language: string): string {
  const format = formatFor(language);
  const seconds = Math.round((timestamp - Date.now()) / 1000);
  for (const [unit, size] of UNIT_STEPS) {
    if (Math.abs(seconds) >= size) return format.format(Math.trunc(seconds / size), unit);
  }
  return format.format(seconds, 'second');
}

/**
 * The memoized relative time formatter for `language`.
 */
function formatFor(language: string): Intl.RelativeTimeFormat {
  let format = timeFormats.get(language);
  if (isUndefined(format)) {
    format = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
    timeFormats.set(language, format);
  }
  return format;
}
