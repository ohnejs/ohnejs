import type { Child } from '../render/insert.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { button } from './button.ts';
import { popup } from './popup-overlay.ts';
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

const INLINE = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g;
const FENCE = /```\w*\n?([\s\S]*?)```/g;

function inlineNode(token: RegExpExecArray): Node {
  if (!isUndefined(token[1])) {
    const strong = document.createElement('strong');
    strong.textContent = token[1];
    return strong;
  }
  if (!isUndefined(token[2])) {
    const code = document.createElement('code');
    code.textContent = token[2];
    return code;
  }
  const url = token[4]!;
  if (!/^https?:\/\//.test(url)) return document.createTextNode(token[0]);
  const anchor = document.createElement('a');
  anchor.textContent = token[3]!;
  anchor.setAttribute('href', url);
  anchor.setAttribute('target', '_blank');
  anchor.setAttribute('rel', 'noopener noreferrer');
  return anchor;
}

function renderInline(target: Node, text: string): void {
  text.split('\n').forEach((line, index) => {
    if (index > 0) target.appendChild(document.createElement('br'));
    let cursor = 0;
    for (const token of line.matchAll(INLINE)) {
      if (token.index > cursor) {
        target.appendChild(document.createTextNode(line.slice(cursor, token.index)));
      }
      target.appendChild(inlineNode(token));
      cursor = token.index + token[0].length;
    }
    if (cursor < line.length) target.appendChild(document.createTextNode(line.slice(cursor)));
  });
}

function renderBlocks(target: HTMLElement, text: string): void {
  for (const block of text.split(/\n{2,}/)) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    const lines = trimmed.split('\n');
    if (lines.every((line) => line.startsWith('>'))) {
      const quote = document.createElement('blockquote');
      const paragraph = document.createElement('p');
      renderInline(paragraph, lines.map((line) => line.replace(/^> ?/, '')).join('\n'));
      quote.appendChild(paragraph);
      target.appendChild(quote);
    } else {
      const paragraph = document.createElement('p');
      renderInline(paragraph, trimmed);
      target.appendChild(paragraph);
    }
  }
}

/**
 * Renders markdown-lite `text` into `target` as constructed DOM nodes.
 * The grammar covers paragraphs, ```` ``` ```` code fences, `>` blockquotes, `**bold**`,
 * backticked code, `[label](https://url)` links opening in a new tab, and line breaks.
 * `markdown: false` renders the text as-is.
 *
 * The zero-dependency stand-in for the source's marked + DOMPurify pipeline: content never
 * reaches `innerHTML`, so server-provided strings stay inert.
 * Style the target with `ohne-prose` for the typographic flow.
 */
export function renderProse(target: HTMLElement, text: string, markdown = true): void {
  target.textContent = '';
  if (!markdown) {
    target.textContent = text;
    return;
  }
  let cursor = 0;
  for (const fence of text.matchAll(FENCE)) {
    renderBlocks(target, text.slice(cursor, fence.index));
    const pre = document.createElement('pre');
    const code = document.createElement('code');
    code.textContent = fence[1] ?? '';
    pre.appendChild(code);
    target.appendChild(pre);
    cursor = fence.index + fence[0].length;
  }
  renderBlocks(target, text.slice(cursor));
}

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
 * Resolves with the name of the clicked action, or `undefined` when the dialog is dismissed
 * by Escape or an overlay click.
 *
 * There is no queue, exactly as the source documents: calling `openDialog` while a dialog is
 * open replaces it, and the earlier promise never settles.
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
 * The global confirm dialog outlet, ported 1-to-1 from Pruvious v4's `PUIDialog`.
 * Mount it once in the shell; it renders the `openDialog` state inside a popup sized by the
 * `--ohne-dialog-size` knob, with the actions right-aligned in array order.
 * Every dismissal path settles the promise: an action click with its name, Escape and the
 * overlay click with `undefined`.
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
