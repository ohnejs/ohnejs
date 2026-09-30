import {
  api,
  attachTooltip,
  badge,
  card,
  type Child,
  css,
  type DashboardCollection,
  type DashboardMeta,
  dashboardMeta,
  each,
  fallbackLabel,
  formatDateTime,
  formatRelative,
  h,
  icon,
  joinLabel,
  useT,
  when,
} from 'ohnejs/dashboard';
import {
  computed,
  type ConditionObject,
  debounce,
  effect,
  first,
  isEmpty,
  isNumber,
  isString,
  isUndefined,
  keywordsCondition,
  onCleanup,
  recordHref,
  ref,
  untracked,
} from 'ohnejs/utils';

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
 * `where` narrows the collection's read to the search, `undefined` when nothing narrows it.
 * `rows` buffers the records the feed has fetched but not emitted, newest first.
 */
interface Bucket {
  collection: DashboardCollection;
  where: ConditionObject | undefined;
  rows: RecentEdit[];
  offset: number;
  done: boolean;
}

const PAGE_SIZE = 20;

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

  .o-overview-recent-row .ohne-badge {
    max-width: 35%;
  }

  .o-overview-recent-time {
    /* positioned after the stretched link, so the pointer reaches the tooltip */
    position: relative;
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .o-overview-recent-more {
    display: block;
    width: 100%;
    /* defeats the card body's stacking margin */
    margin-top: 0;
    padding: 0.5rem 0.75rem;
    border-top-width: 1px;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
    text-align: center;
  }

  .o-overview-recent-more:hover:not(:disabled) {
    background-color: hsl(var(--ohne-muted) / 0.4);
    color: hsl(var(--ohne-foreground));
  }

  .o-overview-recent-more:disabled {
    cursor: default;
  }

  .o-overview-recent-more:focus-visible {
    outline: 0.125rem solid transparent;
    outline-offset: 0.125rem;
    box-shadow: inset 0 0 0 0.125rem hsl(var(--ohne-ring));
  }
`;

/**
 * The Recent edits widget.
 * The most recently updated records across every readable collection.
 * Each row links to its record page, with its collection in a badge and a relative time, ticking.
 * The time's tooltip is the instant in the user's date and time formats and zone.
 * Each readable collection answers the body-query `POST` ordered by `-_updatedAt`.
 * The collections merge newest first, one page at a time.
 * `Load more` extends the feed and hides once every collection has run out.
 * The shared `search` narrows each collection's read, so the feed pages through matches only.
 * A changed query restarts the feed after a pause; meanwhile the loaded rows filter in place.
 * While searching, an empty card hides.
 */
export function overviewRecentEdits(search: OverviewSearch): Child {
  const t = useT();
  const entries = ref<RecentEdit[]>([]);
  const loaded = ref(false);
  const loading = ref(false);
  const exhausted = ref(false);
  let buckets: Bucket[] | undefined;

  const load = async (feed: Bucket[], reset: boolean): Promise<void> => {
    loading.value = true;
    const page = await takePage(feed);
    if (feed !== buckets) return;
    entries.value = reset ? page : [...entries.value, ...page];
    exhausted.value = isDrained(feed);
    loading.value = false;
    loaded.value = true;
  };

  const loadMore = (): void => {
    if (loading.value || exhausted.value || isUndefined(buckets)) return;
    void load(buckets, false);
  };

  const loadSoon = debounce((feed: Bucket[]) => void load(feed, true), 250);
  onCleanup(loadSoon.cancel);

  effect(() => {
    const meta = dashboardMeta();
    const tokens = search.tokens();
    if (isUndefined(meta)) return;
    const initial = isUndefined(buckets);
    const feed = bucketsOf(meta, tokens);
    buckets = feed;
    loading.value = true;
    if (initial) untracked(() => void load(feed, true));
    else loadSoon(feed);
  });

  const filtered = computed(() =>
    entries.value.filter((entry) =>
      search.matches(entry.label, entry.collectionLabel, entry.collectionName),
    ),
  );

  effect(() => {
    if (!loading.value) search.registerCount('overview-recent-edits', filtered.value.length);
  });
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
                'button',
                {
                  disabled: () => loading.value,
                  type: 'button',
                  class: 'o-overview-recent-more ohne-raw',
                  onClick: loadMore,
                },
                () => t('dashboard.overview.loadMore'),
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
 * One list row: the collection badge, the record link stretched over the row, and the relative time.
 * The badge caps at a share of the row, so a long collection name truncates before it pushes the time off.
 */
function recentRow(entry: () => RecentEdit): Child {
  const time = h('span', { class: 'o-overview-recent-time' }, () =>
    formatRelative(entry().updatedAt),
  );
  onCleanup(attachTooltip(time, () => formatDateTime(entry().updatedAt)));
  return h(
    'li',
    { class: 'o-overview-recent-row' },
    badge(() => entry().collectionLabel, { size: -2, color: 'secondary' }),
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
 * One cursor per readable collection that can match every search token, each starting empty at offset zero.
 * A token in the collection's label or name holds for all its records, so only the rest narrow its read.
 * The rest must each appear in a label field, so a singleton or a collection without one drops out.
 */
function bucketsOf(meta: DashboardMeta, tokens: readonly string[]): Bucket[] {
  const buckets: Bucket[] = [];
  for (const collection of meta.collections) {
    if (collection.operations.read?.allowed !== true) continue;
    const own = `${collection.label} ${collection.name}`.toLowerCase();
    const rest = tokens.filter((token) => !own.includes(token)).slice(0, 10);
    const { singleton, labelFields } = collection;
    if (!isEmpty(rest) && (singleton || isEmpty(labelFields))) continue;
    const where = isEmpty(rest) ? undefined : keywordsCondition(rest, labelFields);
    buckets.push({ collection, where, rows: [], offset: 0, done: false });
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
 */
async function fillBucket(bucket: Bucket): Promise<void> {
  const select = ['UUID', '_updatedAt', ...bucket.collection.labelFields];
  const limit = PAGE_SIZE + 1;
  try {
    const response = await api(`POST /collections/${bucket.collection.segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        select,
        where: bucket.where,
        order: ['-_updatedAt'],
        limit,
        offset: bucket.offset,
      }),
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
      const { singleton, segment } = bucket.collection;
      const label = singleton ? bucket.collection.label : joinLabel(row, bucket.collection);
      bucket.rows.push({
        collectionName: bucket.collection.name,
        collectionLabel: bucket.collection.label,
        uuid,
        label: label !== '' ? label : fallbackLabel(uuid),
        updatedAt,
        editURL: singleton ? `/collections/${segment}` : recordHref(bucket.collection, uuid),
      });
    }
  } catch {
    bucket.done = true;
  }
}
