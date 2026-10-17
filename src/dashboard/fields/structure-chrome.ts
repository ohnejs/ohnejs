import type { Child } from '../render/insert.ts';
import type { FieldForm } from './field-form.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { nextTick } from '../../utils/reactive/next-tick.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { useT } from '../runtime/use-t.ts';
import { button } from '../ui/button.ts';
import { dropdownItem } from '../ui/dropdown-item.ts';
import { dropdown } from '../ui/dropdown.ts';
import { fieldMessage } from '../ui/field-message.ts';
import { icon, type IconName } from '../ui/icon.ts';
import { renderProse } from '../ui/prose.ts';
import { toast } from '../ui/toaster.ts';
import { attachTooltip } from '../ui/tooltip.ts';
import { type ClipboardData, copyClipboard } from './clipboard.ts';

/**
 * Options for `structureActions`, one hook per action of the item header cluster.
 */
export interface StructureActionsOptions {
  /**
   * The item's reactive position in the list.
   */
  index: () => number;

  /**
   * The reactive list length; the move buttons render only while it is above one.
   */
  count: () => number;

  /**
   * Whether the item is expanded. Reactive.
   */
  expanded: () => boolean;

  /**
   * Whether every item is expanded, hiding the Expand all action. Reactive.
   */
  allExpanded: () => boolean;

  /**
   * Whether every item is collapsed, hiding the Collapse all action. Reactive.
   */
  allCollapsed: () => boolean;

  /**
   * Flips the item's expanded state.
   */
  onToggleExpanded(): void;

  /**
   * Expands every item.
   */
  onExpandAll(): void;

  /**
   * Collapses every item.
   */
  onCollapseAll(): void;

  /**
   * Swaps the item with its previous or next neighbour.
   */
  onMove(delta: -1 | 1): void;

  /**
   * Inserts a new item at `at`.
   * Omitted, the Add before and Add after actions do not render.
   */
  onAdd?(at: number): void;

  /**
   * The clipboard payload for the item's current value; Copy and Cut write it.
   */
  copyPayload(): ClipboardData;

  /**
   * Whether the clipboard holds a payload this item's list accepts. Reactive.
   * The Paste before and Paste after actions render only while it reports `true`.
   */
  canPaste: () => boolean;

  /**
   * Inserts the clipboard payload at `at`.
   */
  onPaste(at: number): void;

  /**
   * Inserts a copy of the item at its own position.
   */
  onDuplicate(): void;

  /**
   * Removes the item; Cut and Delete call it.
   */
  onRemove(): void;
}

css`
  .ohne-item-actions {
    flex-shrink: 0;
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }

  @media (hover: hover) {
    .ohne-item-actions {
      display: none;
    }
  }

  .ohne-structure
    > *
    > :where(.ohne-structure-items)
    > :where(.ohne-card:hover, .ohne-card:focus-within)
    > :where(.ohne-card-header)
    > :where(.ohne-row)
    > .ohne-item-actions,
  .ohne-item-actions-visible {
    display: flex;
  }

  .ohne-item-actions > * {
    flex-shrink: 0;
  }

  /* The drag handle is hidden while disabled; the inset takes its place so the header stays aligned. */
  .ohne-structure-disabled
    > *
    > :where(.ohne-structure-items)
    > :where(.ohne-card)
    > :where(.ohne-card-header)
    > :where(:first-child) {
    margin-left: 0.25rem;
  }

  .ohne-item-error-mark + * {
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-item-error {
    margin-top: -0.25rem;
  }
`;

/**
 * The item header actions cluster the `repeater` and `blocks` controls share.
 *
 * Move up and down, the expand toggle, and the more-actions dropdown.
 * The dropdown carries add, clipboard, duplicate, delete, and expand-all actions.
 * The cluster shows while its card is hovered or focused, or while its dropdown is open.
 * Copy and Cut write `copyClipboard` and toast; the paste actions show only while `canPaste`.
 * A focused move button the item's position disables, by a click or an undo, hands focus to its sibling.
 * A picked action returns focus to the dropdown trigger, unless it hands focus on, as Delete does.
 */
export function structureActions(options: StructureActionsOptions): HTMLElement {
  const t = useT();
  const open = ref(false);
  const close = (): void => {
    open.value = false;
  };

  const copy = (): void => {
    copyClipboard(options.copyPayload());
    toast(t('dashboard.clipboard.copied'), { type: 'success' });
  };

  const action = (
    shape: IconName,
    label: () => string,
    onClick: () => void,
    destructive = false,
  ): HTMLElement => {
    const el = dropdownItem([icon(shape), h('span', null, label)], { destructive, onClick });
    effect(() => {
      el.title = label();
    });
    return el;
  };

  const atEdge = (delta: -1 | 1): boolean =>
    delta === -1 ? options.index() === 0 : options.index() === options.count() - 1;

  const moveButton = (delta: -1 | 1, other: () => HTMLElement): HTMLElement => {
    const self = button(
      () => t(delta === -1 ? 'dashboard.sort.moveUp' : 'dashboard.sort.moveDown'),
      {
        icon: delta === -1 ? 'chevron-up' : 'chevron-down',
        iconOnly: true,
        size: -2,
        variant: 'ghost',
        disabled: () => atEdge(delta),
        onClick: () => options.onMove(delta),
      },
    );
    // A focused button that turns disabled drops focus to the body, so its sibling takes it once enabled.
    effect(() => {
      if (!atEdge(delta)) return;
      void nextTick().then(() => {
        if (document.activeElement === self) other().focus();
      });
    });
    return self;
  };

  const moveButtons = (): HTMLElement[] => {
    const up = moveButton(-1, () => down);
    const down = moveButton(1, () => up);
    return [up, down];
  };

  const toggle = button(() => icon(options.expanded() ? 'maximize' : 'minimize'), {
    size: -2,
    variant: 'ghost',
    onClick: () => options.onToggleExpanded(),
  });
  // `button` takes a static variant; the reactive one patches classes, and nothing re-applies over it.
  effect(() => {
    const expanded = options.expanded();
    toggle.classList.toggle('ohne-button-ghost', expanded);
    toggle.classList.toggle('ohne-button-accent', !expanded);
  });
  onCleanup(
    attachTooltip(toggle, () =>
      t(options.expanded() ? 'dashboard.menu.collapse' : 'dashboard.menu.expand'),
    ),
  );

  const dots = button(() => t('dashboard.record.moreActions'), {
    icon: 'dots-vertical',
    iconOnly: true,
    size: -2,
    variant: 'ghost',
    onClick: () => {
      open.value = !open.value;
    },
  });
  effect(() => {
    dots.classList.toggle('ohne-button-ghost', !open.value);
    dots.classList.toggle('ohne-button-primary', open.value);
  });

  // The trigger takes focus while the open menu still shows the cluster, before the action can move it on.
  const settle = (run: () => void): void => {
    dots.focus();
    close();
    void nextTick().then(run);
  };

  const menu = (): Child => {
    const handle = dropdown(
      [
        isUndefined(options.onAdd)
          ? null
          : [
              action(
                'arrow-bar-to-up',
                () => t('dashboard.sort.addBefore'),
                () => settle(() => options.onAdd?.(options.index())),
              ),
              action(
                'arrow-bar-to-down',
                () => t('dashboard.sort.addAfter'),
                () => settle(() => options.onAdd?.(options.index() + 1)),
              ),
            ],
        h('hr'),
        action(
          'clipboard',
          () => t('dashboard.clipboard.copy'),
          () => settle(copy),
        ),
        action(
          'cut',
          () => t('dashboard.clipboard.cut'),
          () =>
            settle(() => {
              copy();
              options.onRemove();
            }),
        ),
        when(options.canPaste, () => [
          action(
            'clipboard-plus',
            () => t('dashboard.clipboard.pasteBefore'),
            () => settle(() => options.onPaste(options.index())),
          ),
          action(
            'clipboard-plus',
            () => t('dashboard.clipboard.pasteAfter'),
            () => settle(() => options.onPaste(options.index() + 1)),
          ),
        ]),
        h('hr'),
        action(
          'copy',
          () => t('dashboard.duplicate'),
          () => settle(() => options.onDuplicate()),
        ),
        action(
          'trash',
          () => t('dashboard.delete'),
          () => settle(() => options.onRemove()),
          true,
        ),
        h('hr'),
        when(
          () => !options.allExpanded(),
          () =>
            action(
              'maximize',
              () => t('dashboard.menu.expandAll'),
              () => settle(() => options.onExpandAll()),
            ),
        ),
        when(
          () => !options.allCollapsed(),
          () =>
            action(
              'minimize',
              () => t('dashboard.menu.collapseAll'),
              () => settle(() => options.onCollapseAll()),
            ),
        ),
      ],
      { reference: dots, placement: 'end', onClose: close },
    );
    handle.root.addEventListener('click', close);
    return handle.root;
  };

  return h(
    'span',
    { class: () => 'ohne-item-actions' + (open.value ? ' ohne-item-actions-visible' : '') },
    when(() => options.count() > 1, moveButtons),
    toggle,
    dots,
    when(() => open.value, menu),
  );
}

/**
 * Where focus stood around one list item, shared by every copy the list makes of the item.
 * A restore reads it to hand focus on as the item's own action did.
 */
export interface ItemFocus {
  /**
   * The element inside the item that last took focus, its header actions included.
   */
  last?: HTMLElement;

  /**
   * The body control that last took focus, which an undo bringing the item back focuses again.
   */
  held?: HTMLElement;

  /**
   * Puts focus back where it came from when the item was added, for the undo that drops the item again.
   * A removal through the menu clears it, since that removal's own hand-off is the one a redo repeats.
   */
  origin?: () => void;
}

/**
 * A list item as the focus hand-offs see it.
 */
interface ListItem {
  $expanded: boolean;
  form: FieldForm;
}

/**
 * A list item that remembers where focus stood around it.
 */
interface TrackedItem extends ListItem {
  focus: ItemFocus;
}

/**
 * Records into `focus` whatever takes focus inside `element`, as the item's `held` control too when `body`.
 */
export function trackItemFocus<T extends HTMLElement>(
  focus: ItemFocus,
  element: T,
  body: boolean,
): T {
  element.addEventListener('focusin', ({ target }) => {
    if (!(target instanceof HTMLElement)) return;
    focus.last = target;
    if (body) focus.held = target;
  });
  return element;
}

/**
 * The way back to where focus stood when an item was added: `from` itself, else into `source`.
 * A menu trigger hides with its card's hover, so the item whose menu added the new one stands in for it.
 * It takes the control that held focus in `source` at the time, not one a later step moved it to.
 */
export function focusOrigin(from: Element | null, source?: TrackedItem): () => void {
  const held = source?.focus.held;
  return () => {
    if (from instanceof HTMLElement) from.focus();
    if (document.activeElement !== from && !isUndefined(source)) focusInto(source, held);
  };
}

/**
 * Hands focus on after the item at `at` left the list: to the item now there, else the one before.
 * A collapsed item shows no control, so it is passed over; with neither shown, `fallback` takes focus.
 */
export function focusAfterRemoval(
  items: readonly ListItem[],
  at: number,
  fallback: HTMLElement,
): void {
  const target = [items[at], items[at - 1]].find((item) => item?.$expanded === true);
  if (isUndefined(target)) fallback.focus();
  else target.form.focus();
}

/**
 * Hands focus on once a restore took the list from `before` to `after` and flushed, as its actions do.
 * The first item the restore brought in takes it, on the control that last held it, else on its first.
 * Otherwise, when the item holding focus left, focus returns where it came from when the item was added.
 * Failing that, it goes on as after a removal: to the item now at its place, else the one before.
 * With neither shown, `fallback` takes it.
 * It settles a tick after the flush, behind a host that follows the changed text on the flush's own tick.
 */
export function focusAfterRestore(
  before: readonly TrackedItem[],
  after: readonly TrackedItem[],
  fallback: HTMLElement,
): void {
  const came = after.find((item) => !before.includes(item));
  const left = before.find(
    (item) => item.focus.last === document.activeElement && !after.includes(item),
  );
  if (isUndefined(came) && isUndefined(left)) return;
  // Read now: the host's pass moves focus inside the item, and the memory would record that as held.
  const held = came?.focus.held;
  void nextTick().then(() =>
    nextTick().then(() => {
      if (!isUndefined(came)) {
        focusInto(came, held);
        return;
      }
      if (isUndefined(left)) return;
      const dropped = document.activeElement;
      left.focus.origin?.();
      if (document.activeElement === dropped) {
        focusAfterRemoval(after, before.indexOf(left), fallback);
      }
    }),
  );
}

/**
 * Focuses `held`, the control that held focus inside `item`, else its first; a collapsed item shows none.
 */
function focusInto(item: TrackedItem, held: HTMLElement | undefined): void {
  if (!item.$expanded) return;
  if (held?.isConnected === true) held.focus();
  else item.form.focus();
}

/**
 * The hidden marker rendered before an errored item's card.
 * While `errored` reports `true`, the sibling selector paints the card border destructive.
 */
export function structureErrorMark(errored: () => boolean): Child {
  return when(errored, () => h('div', { hidden: true, class: 'ohne-item-error-mark' }));
}

/**
 * The item-level error message rendered under an item's card.
 * Renders nothing while `message` is empty.
 */
export function structureItemError(message: () => string): Child {
  const errorProse = (): HTMLElement => {
    const flow = h('div', { class: 'ohne-prose' });
    renderProse(flow, message(), { links: false });
    return flow;
  };
  return when(
    () => message() !== '',
    () => h('div', { class: 'ohne-item-error' }, fieldMessage(errorProse, { error: () => true })),
  );
}
