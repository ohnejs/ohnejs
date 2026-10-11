import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';
import type { IconName } from './icon.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { type MaybeGetter, toValue } from '../../utils/reactive/to-value.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { keyed } from '../render/keyed.ts';
import { when } from '../render/when.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { buttonGroup } from './button-group.ts';
import { icon } from './icon.ts';
import './tokens.ts';

/**
 * One tab of `tabs`, typed by its name.
 */
export interface TabItem<T extends string | number> {
  /**
   * The tab's identity, unique among the tabs; the `active` ref holds it.
   */
  name: T;

  /**
   * The tab label.
   */
  label: Text;

  /**
   * An icon before the label.
   */
  icon?: IconName;

  /**
   * Content after the label, usually a `bubble` with a count.
   */
  bubble?: Child;

  /**
   * Builds the panel each time the tab activates; switching away disposes it.
   */
  content: () => Child;
}

/**
 * Options for `tabs`, typed by the tab names.
 */
export interface TabsOptions<T extends string | number> {
  /**
   * The active tab's name, read and written by the tabs.
   * A name no tab carries shows the first tab.
   * Omitted, the tabs keep their own state and start on the first tab.
   */
  active?: Ref<T>;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;
}

css`
  .ohne-tabs-list.ohne-button-group {
    width: 100%;
  }

  .ohne-tabs-list .ohne-button-group-item {
    flex-grow: 1;
    justify-content: center;
  }

  .ohne-tabs-list .ohne-button-group-item > svg {
    flex-shrink: 0;
    font-size: calc(1em + 0.125rem);
  }

  .ohne-tabs-list .ohne-bubble {
    border: none;
  }

  .ohne-tabs-content:not(:first-child) {
    margin-top: 0.5em;
  }
`;

/**
 * A row of equal-width tabs over the active tab's panel, typed by the tab names.
 * With an `active` ref the names are typed by the ref, so every tab must carry one of its values.
 * Only the active panel is mounted; switching tabs disposes the old one and builds the new one fresh.
 * The panel area keeps the outgoing height for 250ms, so the layout never jumps while the next one mounts.
 * The tab row appears only when there is more than one tab.
 *
 * @example
 * ```ts
 * const view = ref<'roster' | 'loot'>('roster')
 * tabs(
 *   [
 *     { name: 'roster', label: 'Roster', icon: 'users', content: () => roster() },
 *     { name: 'loot', label: 'Loot', bubble: bubble('3'), content: () => loot() },
 *   ],
 *   { active: view },
 * )
 * ```
 */
export function tabs<const T extends string | number>(
  items: MaybeGetter<readonly TabItem<NoInfer<T>>[]>,
  options: TabsOptions<T> & { active: Ref<T> },
): HTMLElement;
export function tabs<const T extends string | number>(
  items: MaybeGetter<readonly TabItem<T>[]>,
  options?: Omit<TabsOptions<T>, 'active'>,
): HTMLElement;
export function tabs<T extends string | number>(
  items: MaybeGetter<readonly TabItem<T>[]>,
  options: TabsOptions<T> = {},
): HTMLElement {
  const list = (): readonly TabItem<T>[] => toValue(items);
  const chosen: Ref<T | undefined> = options.active ?? ref<T | undefined>(undefined);
  const active = computed(() => {
    const names = list().map((item) => item.name);
    const name = chosen.value;
    return !isUndefined(name) && names.includes(name) ? name : names[0];
  });
  const model: Ref<T | undefined> = {
    get value(): T | undefined {
      return active.value;
    },
    set value(name: T | undefined) {
      chosen.value = name;
    },
  };

  const minHeight = ref<number | undefined>(undefined);
  let minHeightTimeout: ReturnType<typeof setTimeout> | undefined;
  const pinHeight = (height: number): void => {
    clearTimeout(minHeightTimeout);
    minHeight.value = height;
    minHeightTimeout = setTimeout(() => {
      minHeight.value = undefined;
    }, 250);
  };
  onCleanup(() => clearTimeout(minHeightTimeout));

  const panel = h(
    'div',
    null,
    keyed(
      () => active.value,
      () =>
        list()
          .find((item) => item.name === active.value)
          ?.content() ?? null,
    ),
  );

  let first = true;
  effect(() => {
    void active.value;
    if (first) {
      first = false;
      return;
    }
    // Runs on the write, before the panel rebuilds on its microtask, so this measures the outgoing panel.
    pinHeight(panel.offsetHeight);
  });

  const observer = new ResizeObserver(() => {
    const height = panel.offsetHeight;
    if (height > 24) pinHeight(height);
  });
  observer.observe(panel);
  onCleanup(() => observer.disconnect());

  return h(
    'div',
    {
      class: 'ohne-tabs',
      style: isUndefined(options.size) ? undefined : `--ohne-size: ${options.size}`,
    },
    when(
      () => list().length > 1,
      () => {
        const group = buttonGroup(model, {
          choices: () => list().map((item) => ({ value: item.name })),
          variant: 'accent',
          renderChoice: ({ value }) => tabLabel(list().find((item) => item.name === value)),
        });
        group.classList.add('ohne-tabs-list');
        return group;
      },
    ),
    h(
      'div',
      {
        class: 'ohne-tabs-content',
        style: () => (minHeight.value ? `min-height: ${minHeight.value}px` : null),
      },
      panel,
    ),
  );
}

/**
 * One tab's face in the row: its icon, its live label, and its bubble.
 */
function tabLabel<T extends string | number>(item: TabItem<T> | undefined): Child {
  if (isUndefined(item)) return null;
  const { label } = item;
  return [
    isUndefined(item.icon) ? null : icon(item.icon),
    h('span', null, () => resolveText(label)),
    item.bubble,
  ];
}
