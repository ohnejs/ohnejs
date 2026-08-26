import type { Child } from '../render/insert.ts';

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
    display: none;
    gap: 0.25rem;
    margin-left: auto;
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

  /* A disabled structure hides the drag handle; the inset re-aligns the header, as the source. */
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
 * Ported 1-to-1 from the cluster Pruvious v4 duplicates across `Repeater.vue` and `Blocks.vue`.
 *
 * Move up and down, the expand toggle, and the more-actions dropdown.
 * The dropdown carries add, clipboard, duplicate, delete, and expand-all actions.
 * The cluster shows while its card is hovered or focused, or while its dropdown is open.
 * Copy and Cut write `copyClipboard` and toast; the paste actions show only while `canPaste`.
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

  const moveButton = (delta: -1 | 1): HTMLElement => {
    const el = button(icon(delta === -1 ? 'chevron-up' : 'chevron-down'), {
      size: -2,
      variant: 'ghost',
      disabled: () =>
        delta === -1 ? options.index() === 0 : options.index() === options.count() - 1,
      onClick: () => options.onMove(delta),
    });
    onCleanup(
      attachTooltip(el, () =>
        t(delta === -1 ? 'dashboard.sort.moveUp' : 'dashboard.sort.moveDown'),
      ),
    );
    return el;
  };

  const toggle = button(() => icon(options.expanded() ? 'maximize' : 'minimize'), {
    size: -2,
    variant: 'ghost',
    onClick: () => options.onToggleExpanded(),
  });
  // The source binds the variant reactively; `button` takes a static one, so the classes patch here.
  // The button's own class attribute has no reactive dependency, so it never overwrites the patch.
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

  const dots = button(icon('dots-vertical'), {
    size: -2,
    variant: 'ghost',
    onClick: () => {
      open.value = !open.value;
    },
  });
  effect(() => {
    dots.title = t('dashboard.record.moreActions');
  });
  effect(() => {
    dots.classList.toggle('ohne-button-ghost', !open.value);
    dots.classList.toggle('ohne-button-primary', open.value);
  });

  const menu = (): Child => {
    const handle = dropdown(
      [
        options.onAdd === undefined
          ? null
          : [
              action(
                'arrow-bar-to-up',
                () => t('dashboard.sort.addBefore'),
                () => {
                  close();
                  void nextTick().then(() => options.onAdd?.(options.index()));
                },
              ),
              action(
                'arrow-bar-to-down',
                () => t('dashboard.sort.addAfter'),
                () => {
                  close();
                  void nextTick().then(() => options.onAdd?.(options.index() + 1));
                },
              ),
            ],
        h('hr'),
        action(
          'clipboard',
          () => t('dashboard.clipboard.copy'),
          () => {
            copy();
            close();
          },
        ),
        action(
          'cut',
          () => t('dashboard.clipboard.cut'),
          () => {
            copy();
            options.onRemove();
            close();
          },
        ),
        when(options.canPaste, () => [
          action(
            'clipboard-plus',
            () => t('dashboard.clipboard.pasteBefore'),
            () => {
              options.onPaste(options.index());
              close();
            },
          ),
          action(
            'clipboard-plus',
            () => t('dashboard.clipboard.pasteAfter'),
            () => {
              options.onPaste(options.index() + 1);
              close();
            },
          ),
        ]),
        h('hr'),
        action(
          'copy',
          () => t('dashboard.duplicate'),
          () => {
            close();
            void nextTick().then(() => options.onDuplicate());
          },
        ),
        action(
          'trash',
          () => t('dashboard.delete'),
          () => {
            close();
            void nextTick().then(() => options.onRemove());
          },
          true,
        ),
        h('hr'),
        when(
          () => !options.allExpanded(),
          () =>
            action(
              'maximize',
              () => t('dashboard.menu.expandAll'),
              () => {
                close();
                void nextTick().then(() => options.onExpandAll());
              },
            ),
        ),
        when(
          () => !options.allCollapsed(),
          () =>
            action(
              'minimize',
              () => t('dashboard.menu.collapseAll'),
              () => {
                close();
                void nextTick().then(() => options.onCollapseAll());
              },
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
    when(
      () => options.count() > 1,
      () => [moveButton(-1), moveButton(1)],
    ),
    toggle,
    dots,
    when(() => open.value, menu),
  );
}

/**
 * The hidden marker rendered before an errored item's card, the source's `itemBefore` slot.
 * While `errored` reports `true`, the sibling selector paints the card border destructive.
 */
export function structureErrorMark(errored: () => boolean): Child {
  return when(errored, () => h('div', { hidden: true, class: 'ohne-item-error-mark' }));
}

/**
 * The item-level error message rendered under an item's card, the source's `itemAfter` slot.
 * Renders nothing while `message` is empty.
 */
export function structureItemError(message: () => string): Child {
  return when(
    () => message() !== '',
    () => h('div', { class: 'ohne-item-error' }, fieldMessage(message, { error: () => true })),
  );
}
