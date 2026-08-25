import {
  api,
  attachTooltip,
  card,
  type Child,
  css,
  type DashboardCollection,
  type DashboardMeta,
  dashboardMeta,
  each,
  h,
  icon,
  labelFieldOf,
  useDashboardLanguage,
  useT,
  when,
} from 'ohne/dashboard';
import { computed, effect, isNumber, isString, isUndefined, onCleanup, ref } from 'ohne/utils';

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

const LIMIT = 20;

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

  .o-overview-recent-time {
    flex-shrink: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    white-space: nowrap;
  }
`;

/**
 * The Recent edits widget, ported from Pruvious v4's `OverviewRecentEdits`.
 * The most recently updated records across every readable collection.
 * Each row links to its record page, with a relative time and a label-plus-collection tooltip.
 * The source read a dedicated endpoint.
 * Here each readable collection answers the body-query `POST` ordered by `-_updatedAt`.
 * The merged rows keep the newest twenty.
 * The shared `search` filters the rows; while searching, an empty card hides.
 * The source received the search state through a composable; here the page passes it in.
 */
export function overviewRecentEdits(search: OverviewSearch): Child {
  const t = useT();
  const entries = ref<RecentEdit[]>([]);
  const loaded = ref(false);
  let started = false;

  effect(() => {
    const meta = dashboardMeta();
    if (isUndefined(meta) || started) return;
    started = true;
    void loadRecentEdits(meta).then((rows) => {
      entries.value = rows;
      loaded.value = true;
    });
  });

  const filtered = computed(() =>
    entries.value.filter((entry) =>
      search.matches(entry.label, entry.collectionLabel, entry.collectionName),
    ),
  );

  effect(() => search.registerCount('overview-recent-edits', filtered.value.length));
  onCleanup(() => search.unregisterCount('overview-recent-edits'));

  return when(
    () => loaded.value && (filtered.value.length > 0 || !search.active()),
    () => {
      const el = card(
        when(
          () => filtered.value.length === 0,
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
 * The source also renders a collection icon and language and draft badges here.
 * ohne's discovery data has no icons, per-language rows, or draft state.
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
 * The merged feed: every readable collection's newest records, newest first, capped at `LIMIT`.
 */
async function loadRecentEdits(meta: DashboardMeta): Promise<RecentEdit[]> {
  const readable = meta.collections.filter(
    (collection) => collection.operations.read?.allowed === true,
  );
  const buckets = await Promise.all(readable.map((collection) => loadCollection(collection)));
  return buckets
    .flat()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, LIMIT);
}

/**
 * One collection's newest records through the body-query endpoint; a failure resolves empty.
 * A record without a label value shows `#` plus its `UUID`'s first eight characters.
 * That mirrors the source's `#id` fallback.
 */
async function loadCollection(collection: DashboardCollection): Promise<RecentEdit[]> {
  const label = labelFieldOf(collection);
  const select = isUndefined(label) ? ['UUID', '_updatedAt'] : ['UUID', '_updatedAt', label.name];
  try {
    const response = await api(`POST /collections/${collection.segment}/query`, {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ select, order: ['-_updatedAt'], limit: LIMIT }),
    });
    if (!response.ok) return [];
    const rows = (await response.json()) as Record<string, unknown>[];
    const edits: RecentEdit[] = [];
    for (const row of rows) {
      const uuid = row.UUID;
      const updatedAt = row._updatedAt;
      if (!isString(uuid) || !isNumber(updatedAt)) continue;
      const value = isUndefined(label) ? undefined : row[label.name];
      edits.push({
        collectionName: collection.name,
        collectionLabel: collection.label,
        uuid,
        label: isString(value) && value !== '' ? value : `#${uuid.slice(0, 8)}`,
        updatedAt,
        editURL: `/collections/${collection.segment}/${uuid}`,
      });
    }
    return edits;
  } catch {
    return [];
  }
}

/**
 * The elapsed time in words, standing in for the source's `dayjs().fromNow()` via `Intl`.
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
