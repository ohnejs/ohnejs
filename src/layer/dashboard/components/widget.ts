import { type Child, css, h, icon, useT, when } from 'ohne/dashboard';
import { effect, isNull, onCleanup, ref } from 'ohne/utils';

import { logoMark } from './logo.ts';

/**
 * Options for `widget`.
 */
export interface WidgetOptions {
  /**
   * Resolves the edit link for the content behind the widget; `null` hides the link.
   * The caller supplies the destination.
   */
  editHref?: () => string | null;
}

type CollapseSide = 'top' | 'right' | 'bottom' | 'left';

const COLLAPSE_DELAY_MS = 3000;

css`
  .o-widget-wrapper {
    position: fixed;
    inset: 0;
    z-index: var(--o-widget-z-index, 99999);
    overflow: hidden;
    pointer-events: none;
  }

  .o-widget {
    position: absolute;
    top: var(--o-widget-top, auto);
    right: var(--o-widget-right, 0);
    bottom: var(--o-widget-bottom, 4rem);
    left: var(--o-widget-left, auto);
    display: flex;
    overflow: clip;
    pointer-events: auto;
    background-color: var(--o-widget-background, hsl(210 22.2% 96.5%));
    color: var(--o-widget-color, hsl(228 11% 44%));
    border-top-left-radius: var(--o-widget-radius-tl, 1rem);
    border-top-right-radius: var(--o-widget-radius-tr, 0);
    border-bottom-right-radius: var(--o-widget-radius-br, 0);
    border-bottom-left-radius: var(--o-widget-radius-bl, 1rem);
    box-shadow:
      0 0 0 1px var(--o-widget-glow-color, hsl(217 91% 60% / 0.22)),
      0 0 32px 8px var(--o-widget-glow-color, hsl(217 91% 60% / 0.18)),
      0 0 64px 16px var(--o-widget-glow-color, hsl(217 91% 60% / 0.1)),
      var(--o-widget-shadow, 0 1px 6px -1px rgb(0 0 0 / 0.2), 0 2px 4px -2px rgb(0 0 0 / 0.1));
    transition:
      transform 0.25s cubic-bezier(0.4, 0, 0.2, 1),
      box-shadow 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .o-widget-collapsed {
    box-shadow:
      0 0 0 1px transparent,
      0 0 32px 8px transparent,
      0 0 64px 16px transparent,
      var(--o-widget-shadow, 0 1px 6px -1px rgb(0 0 0 / 0.2), 0 2px 4px -2px rgb(0 0 0 / 0.1));
  }

  .o-widget-collapsed[data-side='right'] {
    transform: translateX(calc(100% - 2rem));
  }

  .o-widget-collapsed[data-side='left'] {
    transform: translateX(calc(-100% + 2rem));
  }

  .o-widget-collapsed[data-side='bottom'] {
    transform: translateY(calc(100% - 2rem));
  }

  .o-widget-collapsed[data-side='top'] {
    transform: translateY(calc(-100% + 2rem));
  }

  .o-widget a {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    color: inherit;
    transition: color 0.15s cubic-bezier(0.4, 0, 0.2, 1);
  }

  .o-widget a:not(:last-child) {
    border-right: 1px solid var(--o-widget-divider, hsl(210 8% 90.2%));
  }

  .o-widget a:hover,
  .o-widget a:focus-visible {
    color: var(--o-widget-color-accent, hsl(324 49% 10%));
  }

  .o-widget svg {
    width: 1rem;
    height: 1rem;
  }

  .o-widget-logo {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-right: 1px solid var(--o-widget-divider, hsl(210 8% 90.2%));
  }

  .o-widget-logo .o-mark {
    font-size: 0.875rem;
    line-height: 1;
    opacity: 0.64;
  }

  .dark .o-widget {
    background-color: var(--o-widget-background, hsl(234 16.7% 11.8%));
    color: var(--o-widget-color, hsl(228 11% 65%));
  }

  .dark .o-widget a:not(:last-child) {
    border-right-color: var(--o-widget-divider, hsl(231 16.7% 24%));
  }

  .dark .o-widget a:hover,
  .dark .o-widget a:focus-visible {
    color: var(--o-widget-color-accent, hsl(0 0% 98%));
  }

  .dark .o-widget-logo {
    border-right-color: var(--o-widget-divider, hsl(231 16.7% 24%));
  }
`;

/**
 * The floating dashboard widget.
 * A fixed, `--o-widget-*`-themable pill holding the logo mark, a dashboard link, and an edit link.
 * When a `--o-widget-*` position pins it to a viewport edge, it collapses toward that edge.
 * It waits three seconds after the pointer and focus both leave, and slides back on either's return.
 * It appends itself to `document.body` and removes itself when its owning region disposes.
 */
export function widget(options: WidgetOptions = {}): Child {
  const t = useT();
  const hovered = ref(false);
  const focused = ref(false);
  const collapsed = ref(false);
  const collapsible = ref(false);
  const side = ref<CollapseSide | null>(null);

  let collapseTimer: number | undefined;
  const clearCollapseTimer = (): void => {
    clearTimeout(collapseTimer);
    collapseTimer = undefined;
  };

  const editHref = (): string | null => options.editHref?.() ?? null;

  const widgetEl = h(
    'div',
    {
      'data-side': () => (collapsible.value ? side.value : null),
      class: () => 'o-widget' + (collapsible.value && collapsed.value ? ' o-widget-collapsed' : ''),
      onFocusin: () => {
        focused.value = true;
      },
      onFocusout: (event: FocusEvent) => {
        const next = event.relatedTarget;
        if (next instanceof Node && widgetEl.contains(next)) return;
        focused.value = false;
      },
      onMouseenter: () => {
        hovered.value = true;
      },
      onMouseleave: () => {
        hovered.value = false;
      },
    },
    h('span', { 'aria-hidden': 'true', class: 'o-widget-logo' }, logoMark()),
    h(
      'a',
      { href: '/', class: 'ohne-raw', title: () => t('dashboard.widget.dashboard') },
      icon('adjustments-horizontal'),
    ),
    when(
      () => !isNull(editHref()),
      () =>
        h(
          'a',
          { href: () => editHref() ?? '', class: 'ohne-raw', title: () => t('dashboard.edit') },
          icon('pencil'),
        ),
    ),
  );

  const detectSide = (): void => {
    const styles = getComputedStyle(widgetEl);
    const isZero = (value: string): boolean => parseFloat(value) === 0;
    if (isZero(styles.right)) side.value = 'right';
    else if (isZero(styles.left)) side.value = 'left';
    else if (isZero(styles.bottom)) side.value = 'bottom';
    else if (isZero(styles.top)) side.value = 'top';
    else side.value = null;
    collapsible.value = !isNull(side.value);
  };

  const wrapper = h('div', { class: 'o-widget-wrapper' }, widgetEl);
  document.body.appendChild(wrapper);
  detectSide();

  effect(() => {
    const over = hovered.value;
    const within = focused.value;
    const can = collapsible.value;
    clearCollapseTimer();
    if (!can) {
      collapsed.value = false;
      return;
    }
    if (over || within) {
      collapsed.value = false;
    } else {
      collapseTimer = window.setTimeout(() => {
        collapsed.value = true;
        collapseTimer = undefined;
      }, COLLAPSE_DELAY_MS);
    }
  });

  onCleanup(() => {
    clearCollapseTimer();
    wrapper.remove();
  });

  return null;
}
