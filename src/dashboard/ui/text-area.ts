import type { Ref } from '../../utils/reactive/ref.ts';
import type { Child } from '../render/insert.ts';

import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import './tokens.ts';

/**
 * Options for `textArea`.
 */
export interface TextAreaOptions {
  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Placeholder text shown while the textarea is empty.
   * A getter reads reactively, so a translated placeholder resolves when its catalog lands.
   */
  placeholder?: string | (() => string);

  /**
   * Initial number of visible text lines.
   * Only governs the height when `resize` is `false` or `'manual'`.
   *
   * @default
   * 1
   */
  rows?: number;

  /**
   * How the textarea resizes: `false` fixes the height to `rows`, `'manual'` shows the native drag handle.
   * `'auto'` grows and shrinks with the content.
   *
   * @default
   * 'auto'
   */
  resize?: false | 'manual' | 'auto';

  /**
   * Reports the error state reactively.
   * While it returns `true` the border and the focus ring turn destructive.
   */
  error?: () => boolean;

  /**
   * Disables the textarea reactively while it returns `true`.
   */
  disabled?: () => boolean;

  /**
   * The `id` attribute of the textarea element.
   */
  id?: string;

  /**
   * The `name` attribute of the textarea element.
   */
  name?: string;

  /**
   * The `spellcheck` attribute of the textarea element.
   *
   * @default
   * false
   */
  spellcheck?: boolean;

  /**
   * The `autofocus` attribute of the textarea element.
   *
   * @default
   * false
   */
  autofocus?: boolean;

  /**
   * Content rendered inside the border box, before the textarea.
   */
  prefix?: Child | (() => Child);

  /**
   * Content rendered inside the border box, after the textarea.
   */
  suffix?: Child | (() => Child);

  /**
   * Called when the textarea gains focus, with the value at that moment.
   */
  onFocus?: (event: FocusEvent, value: string) => void;

  /**
   * Called when the textarea loses focus, with the value at that moment.
   */
  onBlur?: (event: FocusEvent, value: string) => void;
}

css`
  .ohne-text-area {
    --ohne-base-size: var(--ohne-size);
    display: flex;
    align-items: center;
    width: 100%;
    overflow: hidden;
    background-color: hsl(var(--ohne-card));
    border: 1px solid hsl(var(--ohne-input));
    border-radius: calc(var(--ohne-radius) - 0.125rem);
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
    transition: var(--ohne-transition);
    transition-property: border-color, box-shadow;
  }

  .ohne-text-area:not(.ohne-text-area-disabled):focus-within {
    border-color: transparent;
    box-shadow: 0 0 0 0.125rem hsl(var(--ohne-ring));
    outline: none;
  }

  .ohne-text-area-has-errors {
    --ohne-ring: var(--ohne-destructive);
    border-color: hsl(var(--ohne-destructive));
  }

  .ohne-text-area-disabled {
    --ohne-foreground: var(--ohne-muted-foreground);
    background-color: hsl(var(--ohne-muted));
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-text-area-control {
    display: flex;
    width: 100%;
    min-height: calc(2em + 0.125rem);
    padding: calc(0.5em - 0.15625rem) 0.5em;
    overflow: hidden;
    -ms-overflow-style: none;
    scrollbar-width: none;
    background-color: transparent;
    border: none;
    outline: none;
    resize: none;
    font-size: 1em;
    line-height: 1.5;
    color: hsl(var(--ohne-foreground));
  }

  .ohne-text-area-control::-webkit-scrollbar {
    display: none;
  }

  .ohne-text-area-control::placeholder {
    color: hsl(var(--ohne-muted-foreground));
  }

  .ohne-text-area-control-resize-manual {
    resize: vertical;
  }
`;

/**
 * A multi-line variant of `textInput`.
 * By default it autosizes: the height follows the content, re-measured when the width changes.
 * Typing writes into the model; writing the model updates the textarea.
 * Escape blurs the textarea without bubbling, and double-clicks stop at the box.
 *
 * The resize mode is read once at construction.
 *
 * @example
 * ```ts
 * const notes = ref('')
 * textArea(notes, { placeholder: 'Notes' })
 * ```
 */
export function textArea(model: Ref<string>, options: TextAreaOptions = {}): HTMLElement {
  const resize = options.resize ?? 'auto';
  const area = h('textarea', {
    autofocus: options.autofocus ?? false,
    disabled: options.disabled,
    id: options.id,
    name: options.name,
    placeholder: options.placeholder,
    rows: options.rows ?? 1,
    spellcheck: String(options.spellcheck ?? false),
    class: `ohne-text-area-control${resize === 'manual' ? ' ohne-text-area-control-resize-manual' : ''}`,
  }) as HTMLTextAreaElement;
  area.addEventListener('input', () => {
    model.value = area.value;
  });
  area.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    }
  });
  if (options.onFocus) {
    const onFocus = options.onFocus;
    area.addEventListener('focus', (event) => onFocus(event, area.value));
  }
  if (options.onBlur) {
    const onBlur = options.onBlur;
    area.addEventListener('blur', (event) => onBlur(event, area.value));
  }
  const autosize = (): void => {
    // Collapsing to 1px first makes `scrollHeight` the exact content height plus padding.
    area.style.height = '1px';
    area.style.height = `${area.scrollHeight}px`;
  };
  batchedEffect(() => {
    if (area.value !== model.value) area.value = model.value;
    if (resize === 'auto') autosize();
  });
  if (resize === 'auto') {
    let lastWidth = 0;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width === lastWidth) return;
      lastWidth = width;
      requestAnimationFrame(autosize);
    });
    observer.observe(area);
    onCleanup(() => observer.disconnect());
    // Out of the document `scrollHeight` is 0, so the initial value sizes once mounted.
    queueMicrotask(autosize);
  }
  return h(
    'div',
    {
      class: () =>
        'ohne-text-area' +
        (options.error?.() ? ' ohne-text-area-has-errors' : '') +
        (options.disabled?.() ? ' ohne-text-area-disabled' : ''),
      style: options.size === undefined ? undefined : `--ohne-size: ${options.size}`,
      onDblclick: (event: MouseEvent) => event.stopPropagation(),
    },
    options.prefix,
    area,
    options.suffix,
  );
}
