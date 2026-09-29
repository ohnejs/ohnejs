import {
  api,
  type Child,
  css,
  dashboardMeta,
  each,
  fallbackLabel,
  h,
  hasModifierKey,
  icon,
  navigate,
  type Popup,
  popup,
  textInput,
  useT,
  verticalMenu,
  when,
} from 'ohnejs/dashboard';
import {
  computed,
  debounce,
  effect,
  isNull,
  isNullish,
  isUndefined,
  nextTick,
  onCleanup,
  ref,
  untracked,
} from 'ohnejs/utils';

import { paletteSlots } from './palette-slots.ts';
import {
  closePalette,
  movePaletteActive,
  type PaletteHit,
  paletteActive,
  paletteGroups,
  paletteHits,
  paletteOpen,
  paletteQuery,
  paletteView,
} from './palette-state.ts';

css`
  .o-palette .ohne-popup-container {
    margin-top: 12dvh;
  }

  .o-palette-search .o-palette-search-icon {
    margin-left: 0.75rem;
    margin-right: 0;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 1rem;
  }

  .o-palette-results {
    display: flex;
    flex-direction: column;
    gap: 1em;
  }

  .o-palette-empty {
    padding: 1.5rem 0.75rem;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
    text-align: center;
  }
`;

/**
 * The search palette, mounted by the dashboard boot into the shell's `global` slot.
 * It renders while `paletteOpen` is set: a search input over the matching records and pages.
 * Typing searches every collection through `POST /search` after a pause; the hits group by collection.
 * The sidebar's menu rows matching the query follow, so a page is one Enter away.
 * ArrowUp and ArrowDown move the selection, Enter opens it, and Escape closes the palette.
 * A row navigates once the palette has closed, or the next page's shell would mount it again.
 * A modified click on a row keeps the browser's behaviour and the palette open.
 * The `row` slot renderers follow the results, and the `view` slot renderers fill the body under their view.
 */
export function palette(): Child {
  return when(
    () => paletteOpen.value,
    () => {
      const t = useT();
      const searching = ref(false);
      const groups = computed(() => {
        const meta = dashboardMeta();
        const query = paletteQuery.value;
        return paletteGroups(query, paletteHits.value, meta?.collections ?? [], meta?.menu ?? []);
      });
      const entries = computed(() => groups.value.flatMap((group) => group.entries));

      let live = true;
      let closing = false;
      const close = (after?: () => void): void => {
        if (closing) return;
        closing = true;
        void handle.close().then(() => {
          closePalette();
          after?.();
        });
      };

      const search = debounce(async (query: string) => {
        const hits = await fetchHits(query);
        if (!live || untracked(() => paletteQuery.value.trim()) !== query) return;
        paletteHits.value = hits;
        searching.value = false;
      }, 200);
      onCleanup(() => {
        live = false;
        search.cancel();
      });

      effect(() => {
        const query = paletteQuery.value.trim();
        untracked(() => {
          searching.value = query !== '';
          if (query === '') {
            search.cancel();
            paletteHits.value = [];
          } else {
            search(query);
          }
        });
      });

      effect(() => {
        void groups.value;
        untracked(() => (paletteActive.value = 0));
      });

      const searchIcon = icon('search');
      searchIcon.classList.add('o-palette-search-icon');
      const box = textInput(paletteQuery, {
        autofocus: true,
        placeholder: () => t('dashboard.palette.placeholder'),
        prefix: searchIcon,
      });
      box.classList.add('o-palette-search');
      const input = box.querySelector('input');
      if (!isNull(input))
        effect(() => input.setAttribute('aria-label', t('dashboard.palette.label')));

      // Capture phase: the input's own Escape handler blurs it and stops the event from bubbling.
      box.addEventListener(
        'keydown',
        (event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            close();
            return;
          }
          if (untracked(() => paletteView.value) !== 'search') return;
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            movePaletteActive(
              event.key === 'ArrowDown' ? 1 : -1,
              untracked(() => entries.value).length,
            );
          } else if (event.key === 'Enter') {
            const entry = untracked(() => entries.value)[untracked(() => paletteActive.value)];
            if (isUndefined(entry)) return;
            event.preventDefault();
            close(() => navigate(entry.to));
          }
        },
        { capture: true },
      );

      const results = h(
        'div',
        {
          class: 'o-palette-results',
          onClick: (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            const to = target?.closest('a')?.getAttribute('href');
            if (isNullish(to) || event.button !== 0 || hasModifierKey(event)) return;
            event.preventDefault();
            close(() => navigate(to));
          },
        },
        each(
          () => groups.value,
          (group) => group.key,
          (group) =>
            verticalMenu({
              title: untracked(group).label || undefined,
              items: () =>
                group().entries.map((entry) => ({
                  to: entry.to,
                  label: entry.label,
                  active: entry.index === paletteActive.value,
                })),
            }),
        ),
      );

      effect(() => {
        void paletteActive.value;
        void groups.value;
        void nextTick().then(() =>
          results
            .querySelector('.ohne-vertical-menu-item-active')
            ?.scrollIntoView({ block: 'nearest' }),
        );
      });

      const handle: Popup = popup(
        [
          when(
            () => paletteView.value === 'search',
            () => [
              results,
              when(
                () =>
                  paletteQuery.value.trim() !== '' &&
                  !searching.value &&
                  entries.value.length === 0,
                () =>
                  h(
                    'div',
                    { 'aria-live': 'polite', role: 'status', class: 'o-palette-empty' },
                    () => t('dashboard.noResultsFound'),
                  ),
              ),
              paletteSlots('row').map((render) => render()),
            ],
          ),
          paletteSlots('view').map((render) => render()),
        ],
        {
          width: '36rem',
          size: -1,
          fullHeight: 'auto',
          additionalClasses: ['o-palette'],
          header: box,
          onClose: () => close(),
        },
      );
      return null;
    },
  );
}

/**
 * The records `POST /search` finds for `query`, each unlabeled one named by its short `UUID`.
 * A failed request finds nothing.
 */
async function fetchHits(query: string): Promise<PaletteHit[]> {
  try {
    const response = await api('POST /search', {
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ q: query }),
    });
    if (!response.ok) return [];
    const { results } = (await response.json()) as { results: PaletteHit[] };
    return results.map((hit) =>
      hit.label === '' ? { ...hit, label: fallbackLabel(hit.UUID) } : hit,
    );
  } catch {
    return [];
  }
}
