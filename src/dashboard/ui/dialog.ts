import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { button } from './button.ts';
import { popup } from './popup-overlay.ts';
import { renderProse } from './prose.ts';
import './tokens.ts';

/**
 * One action button of a dialog.
 */
export interface DialogAction {
  /**
   * A unique name for the action button.
   * `openDialog` resolves with this name when the button is clicked.
   */
  name: string;

  /**
   * The action button label.
   * If not provided, the `name` is used as the label.
   */
  label?: string;

  /**
   * The variant of the action button.
   *
   * @default
   * 'outline'
   */
  variant?: 'primary' | 'secondary' | 'accent' | 'destructive' | 'outline' | 'ghost';
}

/**
 * Options for `openDialog`.
 */
export interface DialogOptions<TActions extends readonly DialogAction[]> {
  /**
   * The text content of the dialog.
   */
  content?: string;

  /**
   * Controls if the `content` is rendered as markdown-lite (see `renderProse`).
   * `false` renders the content as plain text.
   *
   * @default
   * true
   */
  markdown?: boolean;

  /**
   * The action buttons to display in the dialog, in order, right-aligned.
   */
  actions: TActions;

  /**
   * The CSS width of the popup.
   *
   * @default
   * '30rem'
   */
  width?: string;
}

interface DialogState {
  content?: string;
  markdown: boolean;
  actions: {
    name: string;
    label: string;
    variant: NonNullable<DialogAction['variant']>;
    resolve: () => void;
  }[];
  width: string;
  dismiss: () => void;
}

const state = ref<DialogState | null>(null);

css`
  .ohne-dialog {
    --ohne-size: var(--ohne-dialog-size);
  }

  .ohne-dialog-content {
    margin-bottom: 1em;
    font-weight: 500;
  }

  .ohne-dialog-actions {
    display: flex;
    gap: 0.5rem;
    justify-content: flex-end;
    flex-wrap: wrap;
  }
`;

/**
 * Opens the global confirm dialog; `dialogHost` renders it.
 * Resolves with the name of the clicked action, or `undefined` on Escape or an overlay click.
 *
 * There is no queue.
 * Calling `openDialog` while a dialog is open replaces it, and the earlier promise never settles.
 *
 * @example
 * ```ts
 * const action = await openDialog({
 *   content: 'Are you sure you want to delete this item?',
 *   actions: [
 *     { name: 'cancel', label: 'Cancel' },
 *     { name: 'delete', label: 'Delete', variant: 'destructive' },
 *   ],
 * })
 *
 * if (action === 'delete') {
 *   // ...
 * }
 * ```
 */
export function openDialog<const TActions extends readonly DialogAction[]>(
  options: DialogOptions<TActions>,
): Promise<TActions[number]['name'] | undefined> {
  return new Promise((resolve) => {
    state.value = {
      content: options.content,
      markdown: options.markdown ?? true,
      actions: options.actions.map((action) => ({
        ...action,
        label: action.label ?? action.name,
        variant: action.variant ?? 'outline',
        resolve: () => resolve(action.name),
      })),
      width: options.width ?? '30rem',
      dismiss: () => resolve(undefined),
    };
  });
}

/**
 * The global confirm dialog outlet.
 * Mount it once in the shell.
 * It renders the `openDialog` state inside a popup sized by the `--ohne-dialog-size` knob.
 * The actions sit right-aligned in array order.
 * Every dismissal path settles the promise: an action click with its name, a dismissal with `undefined`.
 *
 * @example
 * ```ts
 * h('div', null, page, dialogHost())
 * ```
 */
export function dialogHost(): Child {
  return () => {
    const dialog = state.value;
    if (!dialog) return null;
    const handle = popup(
      [
        isUndefined(dialog.content)
          ? null
          : (() => {
              const content = h('div', { class: 'ohne-dialog-content ohne-prose' });
              renderProse(content, dialog.content, dialog.markdown);
              return content;
            })(),
        h(
          'div',
          { class: 'ohne-dialog-actions' },
          dialog.actions.map((action) =>
            button(action.label, {
              variant: action.variant,
              onClick: () => {
                action.resolve();
                void handle.close().then(() => (state.value = null));
              },
            }),
          ),
        ),
      ],
      {
        additionalClasses: ['ohne-dialog'],
        width: dialog.width,
        onClose: (close) => {
          dialog.dismiss();
          void close().then(() => (state.value = null));
        },
      },
    );
    return null;
  };
}
