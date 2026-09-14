import {
  type Child,
  css,
  defineDashboardPage,
  h,
  icon,
  isMac,
  setDocumentTitle,
  textInput,
  useT,
  when,
} from 'ohnejs/dashboard';
import { computed, effect, isNull, isString, onCleanup, type Ref, ref } from 'ohnejs/utils';

import { overviewQuickCreate } from '../components/overview-quick-create.ts';
import { overviewRecentEdits } from '../components/overview-recent-edits.ts';
import { shell } from '../components/shell.ts';

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
   * Whether the query holds at least one non-whitespace token.
   */
  active: () => boolean;

  /**
   * Whether at least one registered widget reports a visible-results count above zero.
   */
  hasAnyResults: () => boolean;

  /**
   * Whether every query token appears, case-insensitively, in the joined haystacks.
   * An empty query matches everything; nullish and empty haystacks are ignored.
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
  .o-overview {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
  }

  .o-overview-search .o-overview-search-icon {
    margin-left: 0.75rem;
    margin-right: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 1rem;
  }

  .o-overview-search .o-overview-search-clear {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-right: 0.375rem;
    margin-left: 0;
    padding: 0.1875rem;
    border-width: 1px;
    border-color: transparent;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    outline: none;
    background-color: transparent;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    line-height: 1;
  }

  .o-overview-search .o-overview-search-clear:hover {
    background-color: hsl(var(--ohne-muted) / 0.6);
    color: hsl(var(--ohne-foreground));
  }

  .o-overview-search .o-overview-search-clear:focus-visible {
    border-color: hsl(var(--ohne-ring));
    color: hsl(var(--ohne-foreground));
  }

  .o-overview-search .o-overview-search-kbd {
    display: inline-flex;
    align-items: center;
    margin-right: 0.375rem;
    margin-left: 0;
    padding: 0.1875rem 0.4375rem;
    border-width: 1px;
    border-radius: calc(var(--ohne-radius) - 0.25rem);
    background-color: hsl(var(--ohne-muted) / 0.6);
    color: hsl(var(--ohne-muted-foreground));
    font-family: inherit;
    font-size: 0.75rem;
    font-weight: 500;
    line-height: 1;
    letter-spacing: 0.02em;
    white-space: nowrap;
    user-select: none;
  }

  .o-overview-section {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .o-overview-section-title {
    margin: 0;
    padding: 0 0.125rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.025em;
    text-transform: uppercase;
  }

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

  .o-overview-searching .o-overview-section:not(:has(.ohne-card)) {
    display: none;
  }

  .o-overview-no-results {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    align-items: center;
    padding: 3rem 0.75rem;
    color: hsl(var(--ohne-muted-foreground));
    text-align: center;
  }

  .o-overview-no-results svg {
    font-size: 2.5rem;
    opacity: 0.5;
  }

  .o-overview-no-results span {
    font-size: 0.875rem;
  }
`;

/**
 * The overview page.
 * The search input sits over the widget sections, on the signed-in shell.
 */
export default defineDashboardPage(() => shell(() => overview()));

/**
 * The page body: the hotkeyed search input and the Shortcuts and Activity sections.
 * A no-results status shows while an active search matches nothing.
 */
function overview(): Child {
  const t = useT();
  const mac = isMac();
  const search = createOverviewSearch();

  effect(() => setDocumentTitle(t('dashboard.overview.title')));

  const searchIcon = icon('search');
  searchIcon.classList.add('o-overview-search-icon');

  const box = textInput(search.query, {
    size: -1,
    placeholder: () => t('dashboard.search'),
    prefix: searchIcon,
    suffix: () =>
      search.active()
        ? h(
            'button',
            {
              type: 'button',
              class: 'o-overview-search-clear ohne-raw',
              'aria-label': () => t('dashboard.clear'),
              title: () => t('dashboard.clear'),
              onClick: () => clearSearch(),
            },
            icon('x'),
          )
        : h(
            'kbd',
            { 'aria-hidden': 'true', class: 'o-overview-search-kbd' },
            mac ? '⌘K' : 'Ctrl+K',
          ),
  });
  box.classList.add('o-overview-search');

  const input = box.querySelector('input');
  if (!isNull(input)) {
    input.setAttribute('aria-keyshortcuts', 'Meta+K Control+K');
    effect(() => input.setAttribute('aria-label', t('dashboard.search')));
  }

  const focusSearch = (): void => {
    if (!isNull(input)) {
      input.focus();
      input.select();
    }
  };

  const clearSearch = (): void => {
    search.query.value = '';
    focusSearch();
  };

  // Capture phase only: `textInput` blurs on Escape and stops the event before it can bubble here.
  const onKeydown = (event: KeyboardEvent): void => {
    if (
      event.code === 'KeyK' &&
      !event.altKey &&
      !event.shiftKey &&
      ((mac && event.metaKey && !event.ctrlKey) || (!mac && event.ctrlKey && !event.metaKey))
    ) {
      event.preventDefault();
      focusSearch();
    } else if (event.code === 'Escape' && search.active() && document.activeElement === input) {
      event.preventDefault();
      event.stopPropagation();
      clearSearch();
    }
  };
  window.addEventListener('keydown', onKeydown, { capture: true });
  onCleanup(() => window.removeEventListener('keydown', onKeydown, { capture: true }));

  return h(
    'div',
    { class: () => 'o-overview' + (search.active() ? ' o-overview-searching' : '') },
    box,
    h(
      'section',
      { class: 'o-overview-section' },
      h('h2', { class: 'o-overview-section-title' }, () => t('dashboard.overview.shortcuts')),
      h('div', { class: 'o-overview-grid' }, overviewQuickCreate(search)),
    ),
    h(
      'section',
      { class: 'o-overview-section' },
      h('h2', { class: 'o-overview-section-title' }, () => t('dashboard.overview.activity')),
      h('div', { class: 'o-overview-grid' }, overviewRecentEdits(search)),
    ),
    when(
      () => search.active() && !search.hasAnyResults(),
      () =>
        h(
          'div',
          { 'aria-live': 'polite', role: 'status', class: 'o-overview-no-results' },
          icon('search-off'),
          h('span', null, () => t('dashboard.noResultsFound')),
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

  const tokens = computed(() => {
    const trimmed = query.value.trim().toLowerCase();
    return trimmed === '' ? [] : trimmed.split(/\s+/);
  });

  return {
    query,
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
