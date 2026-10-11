import type { Child } from '../render/insert.ts';

import { isArray } from '../../utils/is/is-array.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { isResource, type Resource } from '../runtime/resource.ts';
import { defaultText, type Text } from '../runtime/text.ts';
import { alert } from './alert.ts';
import { button } from './button.ts';
import { emptyState, errorState, skeleton } from './states.ts';
import './tokens.ts';

/**
 * Options for `loaded`.
 */
export interface LoadedOptions<T> {
  /**
   * Whether a value counts as empty, which shows the empty state instead of `render`.
   * Omitted treats an empty array as empty.
   */
  empty?: (value: T) => boolean;

  /**
   * The empty state's text.
   *
   * @default
   * 'dashboard.noItems'
   */
  emptyText?: Text;

  /**
   * The CSS height of the skeleton shown while loading.
   *
   * @default
   * '8rem'
   */
  minHeight?: string;
}

type Phase = 'forbidden' | 'error' | 'loading' | 'empty' | 'ready';

css`
  .ohne-loaded {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    gap: var(--ohne-gap);
  }

  .ohne-loaded-stale > .ohne-loaded-content {
    opacity: 0.6;
  }

  @media (prefers-reduced-motion: no-preference) {
    .ohne-loaded-content {
      transition: opacity 0.15s ease;
    }
  }
`;

/**
 * Renders a data region through every state of its `source`.
 * It shows the first that applies: forbidden, an error with a retry, a skeleton, empty, then `render`.
 * `render` builds once per arrival at the ready state and receives a live getter of the value.
 * A reload or a poll therefore updates the region in place, keeping focus and scroll.
 * A stale value dims and reads as busy; an error over a shown value raises an alert above it.
 * A throw inside `render` shows an error state in this region only.
 * A plain getter has only the loading, empty, and ready states; a `Resource` adds the rest.
 *
 * @example
 * ```ts
 * const raids = useResource<Raid[]>('GET /raids')
 *
 * card(loaded(raids, (list) => h('ul', null, each(list, (raid) => raid.id, raidRow))), {
 *   title: 'Raids',
 * })
 * ```
 */
export function loaded<T>(
  source: () => T | undefined,
  render: (value: () => T) => Child,
  options: LoadedOptions<T> = {},
): () => Child {
  const { emptyText, minHeight = '8rem' } = options;
  const empty = options.empty ?? ((value: T) => isArray(value) && value.length === 0);
  const resource = isResource(source) ? source : undefined;
  const phase = ref<Phase>('loading');
  effect(() => {
    phase.value = phaseOf(source, resource, empty);
  });

  const views: Record<Phase, () => Child> = {
    forbidden: () =>
      emptyState(() => defaultText('dashboard.forbidden', 'You do not have access to this'), {
        icon: 'lock',
      }),
    error: () => errorState(() => messageOf(resource), { retry: () => void resource?.reload() }),
    loading: () => skeleton({ height: minHeight }),
    empty: () =>
      emptyState(emptyText ?? (() => defaultText('dashboard.noItems', 'Nothing here yet'))),
    ready: () => readyView(source, render, resource),
  };
  return () => {
    const current = phase.value;
    return untracked(views[current]);
  };
}

/**
 * The state `source` is in, read in the order `loaded` shows them.
 */
function phaseOf<T>(
  source: () => T | undefined,
  resource: Resource<unknown> | undefined,
  empty: (value: T) => boolean,
): Phase {
  const state = resource?.state();
  if (state === 'forbidden') return 'forbidden';
  const value = source();
  if (isUndefined(value)) return state === 'error' ? 'error' : 'loading';
  try {
    return empty(value) ? 'empty' : 'ready';
  } catch {
    return 'ready';
  }
}

/**
 * The rendered value, dimmed while stale, under an alert while a reload fails.
 */
function readyView<T>(
  source: () => T | undefined,
  render: (value: () => T) => Child,
  resource: Resource<unknown> | undefined,
): HTMLElement {
  let last: T | undefined;
  // Holds the last value, so content outliving its phase never reads `undefined` on the way out.
  const value = (): T => {
    const current = source();
    if (!isUndefined(current)) last = current;
    return last as T;
  };
  let content: Child;
  try {
    content = render(value);
  } catch (error) {
    console.error(error);
    content = errorState();
  }
  return h(
    'div',
    { class: () => (resource?.stale() ? 'ohne-loaded ohne-loaded-stale' : 'ohne-loaded') },
    isUndefined(resource)
      ? null
      : when(
          () => resource.state() === 'error',
          () =>
            alert(() => messageOf(resource), {
              tone: 'destructive',
              icon: 'alert-triangle',
              actions: button(() => defaultText('dashboard.retry', 'Retry'), {
                variant: 'outline',
                size: -1,
                loading: () => resource.busy(),
                onClick: () => void resource.reload(),
              }),
            }),
        ),
    h(
      'div',
      { class: 'ohne-loaded-content', 'aria-busy': () => (resource?.stale() ? 'true' : undefined) },
      content,
    ),
  );
}

/**
 * The failure message of `resource`, or the default load failure text.
 */
function messageOf(resource: Resource<unknown> | undefined): string {
  return resource?.error()?.message ?? defaultText('dashboard.loadFailed', 'Failed to load');
}
