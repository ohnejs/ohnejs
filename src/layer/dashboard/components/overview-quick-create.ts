import {
  button,
  card,
  type Child,
  css,
  dashboardMeta,
  each,
  h,
  icon,
  type IconName,
  useT,
  when,
} from 'ohnejs/dashboard';
import { computed, effect, isUndefined, naturalCompare, onCleanup } from 'ohnejs/utils';

import type { OverviewSearch } from '../pages/overview.ts';

interface QuickCreateShortcut {
  name: string;
  label: string;
  icon: IconName | undefined;
  to: string;
}

css`
  .o-overview-quick-create {
    --ohne-padding-header: 0.625rem 0.75rem;
    --ohne-padding-body: 0.75rem;
  }

  .o-overview-quick-create-header {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    font-size: 0.875rem;
    font-weight: 500;
  }

  .o-overview-quick-create-header svg {
    color: hsl(var(--ohne-muted-foreground));
    font-size: 1rem;
  }

  .o-overview-quick-create-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.375rem;
  }

  .o-overview-quick-create-button {
    flex: 0 0 auto;
  }
`;

/**
 * The Quick create widget.
 * A card of outline buttons, one per creatable collection, each linking to its create page.
 * A collection's declared icon renders before its label.
 * The shared `search` filters them and the card hides while nothing matches.
 */
export function overviewQuickCreate(search: OverviewSearch): Child {
  const t = useT();

  const shortcuts = computed<QuickCreateShortcut[]>(() => {
    const items: QuickCreateShortcut[] = [];
    for (const collection of dashboardMeta()?.collections ?? []) {
      if (collection.operations.create?.allowed !== true) continue;
      items.push({
        name: collection.name,
        label: collection.label,
        icon: collection.icon,
        to: `/collections/${collection.segment}/new`,
      });
    }
    items.sort((a, b) => naturalCompare(a.label, b.label));
    return items;
  });

  const filtered = computed(() =>
    shortcuts.value.filter((shortcut) => search.matches(shortcut.label, shortcut.name)),
  );

  effect(() => search.registerCount('overview-quick-create', filtered.value.length));
  onCleanup(() => search.unregisterCount('overview-quick-create'));

  return when(
    () => filtered.value.length > 0,
    () => {
      const el = card(
        h(
          'div',
          { class: 'o-overview-quick-create-grid' },
          each(
            () => filtered.value,
            (shortcut) => shortcut.name,
            (shortcut) => {
              const link = button(
                [
                  () => {
                    const glyph = shortcut().icon;
                    return isUndefined(glyph) ? null : icon(glyph);
                  },
                  h('span', null, () => shortcut().label),
                ],
                {
                  size: -2,
                  variant: 'outline',
                  href: shortcut().to,
                  class: 'o-overview-quick-create-button',
                },
              );
              // `button` has no title option, so the tooltip attribute tracks the label here.
              effect(() => {
                link.title = shortcut().label;
              });
              return link;
            },
          ),
        ),
        {
          header: h(
            'div',
            { class: 'o-overview-quick-create-header' },
            icon('plus'),
            h('span', null, () => t('dashboard.overview.quickCreate')),
          ),
        },
      );
      el.classList.add('o-overview-quick-create');
      return el;
    },
  );
}
