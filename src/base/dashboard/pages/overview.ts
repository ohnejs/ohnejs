import {
  type Child,
  css,
  defineDashboardPage,
  emptyState,
  h,
  section,
  stack,
  useDocumentTitle,
  useT,
  when,
} from 'ohnejs/dashboard';
import { computed, effect, isString, onCleanup, type Ref, ref, searchTokens } from 'ohnejs/utils';

import { overviewQuickCreate } from '../components/overview-quick-create.ts';
import { overviewRecentEdits } from '../components/overview-recent-edits.ts';
import { searchInput } from '../components/search-input.ts';
import { shellSlots } from '../components/shell-slots.ts';

/**
 * The overview page's shared search state.
 * The page creates one instance per visit and hands it to each widget explicitly.
 * Unmounting therefore resets the query by construction.
 */
export interface OverviewSearch {
  /**
   * The reactive search query the page's input writes.
   */
  query: Ref<string>;

  /**
   * The query's lowercased `searchTokens`; empty while none remain.
   */
  tokens: () => readonly string[];

  /**
   * Whether the query holds at least one search token.
   */
  active: () => boolean;

  /**
   * Whether at least one registered widget reports a visible-results count above zero.
   */
  hasAnyResults: () => boolean;

  /**
   * Whether every query token appears, case-insensitively, in the joined haystacks.
   * A query without search tokens matches everything; nullish and empty haystacks are ignored.
   */
  matches: (...haystacks: (string | null | undefined)[]) => boolean;

  /**
   * Reports a widget's current visible-results count under its stable `key`.
   */
  registerCount: (key: string, count: number) => void;

  /**
   * Removes a widget's count from the tally; call it on cleanup.
   */
  unregisterCount: (key: string) => void;
}

css`
  .o-overview-grid:has(> :nth-child(2)) {
    column-width: 28rem;
    column-gap: 0.75rem;
  }

  .o-overview-grid:has(> :nth-child(2)) .ohne-card {
    display: block;
    width: 100%;
    margin-bottom: 0.75rem;
    break-inside: avoid;
  }

  .o-overview-searching:not(:has(.ohne-card)),
  .o-overview-searching > .ohne-section:not(:has(.ohne-card)) {
    display: none;
  }
`;

/**
 * The overview page.
 * The `overview` shell slot and the search input sit over the widget sections.
 */
export default defineDashboardPage(() => overview());

/**
 * The page: the `overview` shell slot, the search input, and the Shortcuts and Activity sections.
 * A no-results status shows while an active search matches nothing.
 */
function overview(): Child {
  const t = useT();
  const search = createOverviewSearch();

  const field = searchInput(search.query, {
    size: -1,
    placeholder: () => t('dashboard.search'),
    label: () => t('dashboard.search'),
  });

  // Capture phase only: `textInput` blurs on Escape and stops the event before it can bubble here.
  const onKeydown = (event: KeyboardEvent): void => {
    if (event.code === 'Escape' && search.active() && document.activeElement === field.input) {
      event.preventDefault();
      event.stopPropagation();
      field.clear();
    }
  };
  window.addEventListener('keydown', onKeydown, { capture: true });
  onCleanup(() => window.removeEventListener('keydown', onKeydown, { capture: true }));

  useDocumentTitle('dashboard.overview.title');

  const sections = stack(
    { gap: 2 },
    section(
      { title: 'dashboard.overview.shortcuts' },
      h('div', { class: 'o-overview-grid' }, overviewQuickCreate(search)),
    ),
    section(
      { title: 'dashboard.overview.activity' },
      h('div', { class: 'o-overview-grid' }, overviewRecentEdits(search)),
    ),
  );
  effect(() => sections.classList.toggle('o-overview-searching', search.active()));

  return stack(
    { gap: 2 },
    ...shellSlots('overview').map((render) => render()),
    field.box,
    sections,
    when(
      () => search.active() && !search.hasAnyResults(),
      () =>
        h(
          'div',
          { 'aria-live': 'polite', role: 'status' },
          emptyState('dashboard.noResultsFound', { icon: 'search-off' }),
        ),
    ),
  );
}

/**
 * One page visit's search state: the query, its tokenized matcher, and the results tally.
 */
function createOverviewSearch(): OverviewSearch {
  const query = ref('');
  const counts = ref<Record<string, number>>({});

  const tokens = computed(() => searchTokens(query.value).map((token) => token.toLowerCase()));

  return {
    query,
    tokens: () => tokens.value,
    active: () => tokens.value.length > 0,
    hasAnyResults: () => Object.values(counts.value).some((count) => count > 0),
    matches: (...haystacks) => {
      if (tokens.value.length === 0) return true;
      const combined = haystacks
        .filter((haystack): haystack is string => isString(haystack) && haystack.length > 0)
        .join(' ')
        .toLowerCase();
      return tokens.value.every((token) => combined.includes(token));
    },
    registerCount: (key, count) => {
      if (counts.value[key] === count) return;
      counts.value = { ...counts.value, [key]: count };
    },
    unregisterCount: (key) => {
      const next = { ...counts.value };
      delete next[key];
      counts.value = next;
    },
  };
}
