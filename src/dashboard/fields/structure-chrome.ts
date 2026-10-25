import type { Child } from '../render/insert.ts';
import type { Text } from '../runtime/text.ts';
import type { MenuAction, MenuGroup } from '../ui/menu.ts';
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
import { menuRows } from '../ui/_menu-rows.ts';
import { button } from '../ui/button.ts';
import { dropdown } from '../ui/dropdown.ts';
import { fieldMessage } from '../ui/field-message.ts';
import { icon, type IconName } from '../ui/icon.ts';
import { renderProse } from '../ui/prose.ts';
import { toast } from '../ui/toaster.ts';
import { attachTooltip } from '../ui/tooltip.ts';
import { type ClipboardData, copyClipboard } from './clipboard.ts';

/**
 * Options for `structureMenu`, one hook per more action of a list item.
 */
export interface StructureMenuOptions {
  /**
   * The item's reactive position in the list.
   */
  index: () => number;

  /**
   * The reactive list length; the move actions render only while it is above one.
   */
  count: () => number;

  /**
   * Swaps the item with its previous or next neighbour.
   */
  onMove(delta: -1 | 1): void;

  /**
   * Whether every item is expanded, hiding the Expand all action. Reactive.
   */
  allExpanded: () => boolean;

  /**
   * Whether every item is collapsed, hiding the Collapse all action. Reactive.
   */
  allCollapsed: () => boolean;

  /**
   * Expands every item.
   */
  onExpandAll(): void;

  /**
   * Collapses every item.
   */
  onCollapseAll(): void;

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
   * Omitted, the Duplicate action does not render.
   */
  onDuplicate?(): void;

  /**
   * Removes the item; Cut and Delete call it.
   */
  onRemove(): void;
}

/**
 * Options for `structureActions`: the more actions, plus the hooks of the header cluster's own buttons.
 */
export interface StructureActionsOptions extends StructureMenuOptions {
  /**
   * Whether the item is expanded. Reactive.
   */
  expanded: () => boolean;

  /**
   * Flips the item's expanded state.
   */
  onToggleExpanded(): void;
}

css`
  .ohne-item-actions {
    flex-shrink: 0;
    display: flex;
    gap: 0.25rem;
    margin-left: auto;
  }

  @media (hover: hover) and (pointer: fine) {
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
  [data-ohne-context-menu-open] > .ohne-item-actions,
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
 * The more actions of a list item, shared by its header cluster's dropdown and its header's right-click.
 * The item's add, duplicate, and move actions, then the clipboard, then expand-all, then Delete alone.
 * Copy and Cut write `copyClipboard` and toast; the paste actions show only while `canPaste`.
 * The move actions show only while the list holds several items, and disable at the edge they face.
 * A pick hands focus back to `opener` first, then runs a tick later, so its action can still move focus on.
 * `opener` defaults to the element focused when the rows are built, which a right-click reads on open.
 */
export function structureMenu(
  options: StructureMenuOptions,
  opener: Element | null = document.activeElement,
): MenuGroup[] {
  const t = useT();
  const { onAdd, onDuplicate } = options;

  const movable = options.count() > 1;

  const copy = (): void => {
    copyClipboard(options.copyPayload());
    toast(t('dashboard.clipboard.copied'), { type: 'success' });
  };

  const action = (
    shape: IconName,
    label: Text,
    run: () => void,
    extra: Partial<MenuAction> = {},
  ): MenuAction => ({
    icon: shape,
    label,
    ...extra,
    onSelect: () => {
      if (opener instanceof HTMLElement) opener.focus();
      void nextTick().then(run);
    },
  });

  return [
    [
      !isUndefined(onAdd) &&
        action('arrow-bar-to-up', 'dashboard.sort.addBefore', () => onAdd(options.index())),
      !isUndefined(onAdd) &&
        action('arrow-bar-to-down', 'dashboard.sort.addAfter', () => onAdd(options.index() + 1)),
      !isUndefined(onDuplicate) && action('copy', 'dashboard.duplicate', onDuplicate),
      movable &&
        action('chevron-up', 'dashboard.sort.moveUp', () => options.onMove(-1), {
          disabled: () => options.index() === 0,
        }),
      movable &&
        action('chevron-down', 'dashboard.sort.moveDown', () => options.onMove(1), {
          disabled: () => options.index() === options.count() - 1,
        }),
    ],
    [
      action('clipboard', 'dashboard.clipboard.copy', copy),
      action('cut', 'dashboard.clipboard.cut', () => {
        copy();
        options.onRemove();
      }),
      options.canPaste() &&
        action('clipboard-plus', 'dashboard.clipboard.pasteBefore', () =>
          options.onPaste(options.index()),
        ),
      options.canPaste() &&
        action('clipboard-plus', 'dashboard.clipboard.pasteAfter', () =>
          options.onPaste(options.index() + 1),
        ),
    ],
    [
      !options.allExpanded() &&
        action('maximize', 'dashboard.menu.expandAll', () => options.onExpandAll()),
      !options.allCollapsed() &&
        action('minimize', 'dashboard.menu.collapseAll', () => options.onCollapseAll()),
    ],
    [action('trash-x', 'dashboard.delete', () => options.onRemove(), { destructive: true })],
  ];
}

/**
 * The item header actions cluster the `repeater` and `blocks` controls share.
 *
 * Move up and down, the expand toggle, and a dropdown of the `structureMenu` actions.
 * The cluster shows while its card is hovered or focused, or while its dropdown or the header's menu is open.
 * A focused move button the item's position disables, by a click or an undo, hands focus to its sibling.
 * A picked action returns focus to the dropdown trigger, unless it hands focus on, as Delete does.
 */
export function structureActions(options: StructureActionsOptions): HTMLElement {
  const t = useT();
  const open = ref(false);
  const close = (): void => {
    open.value = false;
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

  const toggleLabel = (): string =>
    t(options.expanded() ? 'dashboard.menu.collapse' : 'dashboard.menu.expand');
  const toggle = button(() => icon(options.expanded() ? 'maximize' : 'minimize'), {
    size: -2,
    variant: 'ghost',
    ariaLabel: toggleLabel,
    onClick: () => options.onToggleExpanded(),
  });
  // `button` takes a static variant; the reactive one patches classes, and nothing re-applies over it.
  effect(() => {
    const expanded = options.expanded();
    toggle.classList.toggle('ohne-button-ghost', expanded);
    toggle.classList.toggle('ohne-button-accent', !expanded);
  });
  onCleanup(attachTooltip(toggle, toggleLabel));

  const dots = button(() => t('dashboard.record.moreActions'), {
    icon: 'dots-vertical',
    iconOnly: true,
    size: -2,
    variant: 'ghost',
    onClick: () => {
      open.value = !open.value;
    },
  });
  dots.setAttribute('aria-haspopup', 'menu');
  effect(() => dots.setAttribute('aria-expanded', String(open.value)));

  const menu = (): Child => {
    // The trigger takes focus back on a pick while the closing menu still shows the cluster.
    const handle = dropdown(() => menuRows(structureMenu(options, dots), close), {
      reference: dots,
      placement: 'end',
      onClose: close,
    });
    handle.root.setAttribute('role', 'menu');
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
 * The way back to where focus stood when an item was added: the control `source` held, else `from`.
 * Failing both, it goes into `source`, since a menu trigger hides with its card's hover.
 * It takes the control that held focus in `source` at the time, not one a later step moved it to.
 */
export function focusOrigin(from: Element | null, source?: TrackedItem): () => void {
  const held = source?.focus.held;
  return () => {
    if (source?.$expanded === true && held?.isConnected === true) {
      held.focus();
      return;
    }
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
