import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { Primitive } from './button-group.ts';

import { isFunction } from '../../utils/is/is-function.ts';
import { deepEqual } from '../../utils/object/deep-equal.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { bubble } from './bubble.ts';
import { buttonGroup } from './button-group.ts';
import { attachTooltip } from './tooltip.ts';
import './tokens.ts';

/**
 * The bubble displayed next to a tab label.
 */
export interface TabsBubble {
  /**
   * The content of the bubble; a getter reads reactively.
   */
  content: string | (() => string);

  /**
   * Defines the visual style variant of the bubble.
   *
   * @default
   * 'primary'
   */
  variant?: 'primary' | 'secondary' | 'accent' | 'destructive';

  /**
   * A tooltip to display when hovering over the bubble.
   */
  tooltip?: string;
}

/**
 * One entry in a `tabs` list.
 */
export interface TabsListItem<T extends number | string> {
  /**
   * Unique identifier for the tab item.
   */
  name: T;

  /**
   * Text content displayed as the tab label; a getter reads reactively.
   * If not provided, the `name` is used instead.
   */
  label?: string | (() => string);

  /**
   * An optional bubble to display next to the tab label.
   */
  bubble?: TabsBubble;
}

/**
 * The payload a custom `tabs` nav renderer receives.
 */
export interface TabsNavPayload<T extends number | string> {
  /**
   * The active tab name, read reactively.
   */
  active: () => T | undefined;

  /**
   * The nav choices derived from the list, read reactively.
   */
  choices: () => { label: string; value: T }[];

  /**
   * The id the default nav puts on its hidden input, for external label linkage.
   */
  id: string;

  /**
   * Activates a tab and reports the change.
   */
  setActive: (tab: T) => void;
}

/**
 * Options for `tabs`.
 */
export interface TabsOptions<T extends number | string> {
  /**
   * The tab list, read reactively.
   * A structurally equal re-read does not reset the active tab.
   */
  list: () => TabsListItem<T>[];

  /**
   * The name of the active tab, read reactively.
   * If not provided, the first tab in the list is selected.
   */
  active?: () => T | undefined;

  /**
   * Defines the visual style variant of the tab buttons.
   *
   * @default
   * 'accent'
   */
  variant?: 'primary' | 'accent';

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Called when the user activates a tab; never fires from a list or `active` change.
   */
  onChange?: (tab: T) => void;

  /**
   * Renders the nav in place of the default button group.
   */
  nav?: (payload: TabsNavPayload<T>) => Child;
}

css`
  .ohne-tabs-list.ohne-button-group {
    width: 100%;
  }

  .ohne-tabs-list .ohne-button-group-item {
    flex-grow: 1;
    justify-content: center;
  }

  .ohne-tabs-list .ohne-bubble {
    border: none;
  }

  .ohne-tabs-content:not(:first-child) {
    margin-top: 0.5em;
  }
`;

let sequence = 0;
let activeContext: Ref<number | string | undefined> | null = null;

/**
 * The tab controller, ported 1-to-1 from Pruvious v4's `PUITabs`: it owns the active-tab state,
 * renders a nav (by default an equal-width button group, only when there is more than one tab),
 * and a content area whose min-height is pinned for 250ms during tab switches, so the layout
 * never jumps while the incoming panel mounts.
 * The content is a function, called once during construction; `tab` calls inside it bind to this
 * instance - the port's stand-in for the source's provide/inject.
 * `onChange` fires only from user interaction, never from a prop-driven reset.
 *
 * @example
 * ```ts
 * tabs(() => [tab('general', () => generalPanel()), tab('seo', () => seoPanel())], {
 *   list: () => [{ name: 'general' }, { name: 'seo' }],
 * })
 * ```
 */
export function tabs<T extends number | string>(
  content: () => Child,
  options: TabsOptions<T>,
): HTMLElement {
  const listId = `ohne-tabs-${++sequence}`;
  const active = ref<T | undefined>(undefined);
  const variant = options.variant ?? 'accent';
  const choices = computed(() =>
    options.list().map(({ name, label }) => ({
      label: (isFunction<() => string>(label) ? label() : label) ?? String(name),
      value: name,
    })),
  );

  let previous: [TabsListItem<T>[], T | undefined] | undefined;
  effect(() => {
    const next: [TabsListItem<T>[], T | undefined] = [options.list(), options.active?.()];
    if (previous === undefined || !deepEqual(next, previous)) {
      previous = next;
      active.value = next[1] ?? next[0][0]?.name;
    }
  });

  const setActive = (tab: T): void => {
    active.value = tab;
    options.onChange?.(tab);
  };

  const contentMinHeight = ref<number | undefined>(undefined);
  let minHeightTimeout: ReturnType<typeof setTimeout> | undefined;
  const setContentMinHeight = (minHeight: number | undefined): void => {
    clearTimeout(minHeightTimeout);
    contentMinHeight.value = minHeight;
    minHeightTimeout = setTimeout(() => {
      contentMinHeight.value = undefined;
    }, 250);
  };
  onCleanup(() => clearTimeout(minHeightTimeout));

  const previousContext = activeContext;
  activeContext = active as Ref<number | string | undefined>;
  let inner: HTMLElement;
  try {
    inner = h('div', null, content());
  } finally {
    activeContext = previousContext;
  }

  let first = true;
  effect(() => {
    void active.value;
    if (first) {
      first = false;
      return;
    }
    // This effect runs synchronously on the write, before the panel regions rebuild on their
    // microtask, so it measures the outgoing panel - the source's pre-flush watcher.
    setContentMinHeight(inner.offsetHeight);
  });

  const observer = new ResizeObserver(() => {
    const height = inner.offsetHeight;
    if (height > 24) setContentMinHeight(height);
  });
  observer.observe(inner);
  onCleanup(() => observer.disconnect());

  const groupModel: Ref<Primitive> = {
    get value(): Primitive {
      return active.value;
    },
    set value(next: Primitive) {
      setActive(next as T);
    },
  };

  const renderTab = (index: number, label: string | undefined): Child => {
    const item = options.list()[index];
    const children: Child[] = [h('span', null, label)];
    if (item?.bubble) {
      const badge = bubble(item.bubble.content, { variant: item.bubble.variant });
      if (item.bubble.tooltip) onCleanup(attachTooltip(badge, item.bubble.tooltip));
      children.push(badge);
    }
    return children;
  };

  const defaultNav = (): Child =>
    when(
      () => choices.value.length > 1,
      () => {
        const group = buttonGroup(groupModel, {
          choices: () => choices.value,
          variant,
          id: listId,
          renderChoice: ({ index, label }) => renderTab(index, label),
        });
        group.classList.add('ohne-tabs-list');
        return group;
      },
    );

  return h(
    'div',
    {
      class: 'ohne-tabs',
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
    },
    options.nav
      ? options.nav({
          active: () => active.value,
          choices: () => choices.value,
          id: listId,
          setActive,
        })
      : defaultNav(),
    h(
      'div',
      {
        class: 'ohne-tabs-content',
        style: () => (contentMinHeight.value ? `min-height: ${contentMinHeight.value}px` : null),
      },
      inner,
    ),
  );
}

/**
 * One conditional tab panel: its content renders only while the enclosing `tabs` has `name`
 * active, and unmounts otherwise, so panel-local state resets on switch.
 * Must be called inside the content function of a `tabs` - anywhere else it renders nothing.
 * Pass the content as a function so each activation rebuilds it fresh.
 *
 * @example
 * ```ts
 * tab('general', () => generalPanel())
 * ```
 */
export function tab(name: number | string, content: Child | (() => Child)): Child {
  const active = activeContext;
  if (active === null) return null;
  return when(
    () => active.value === name,
    () => content,
  );
}
