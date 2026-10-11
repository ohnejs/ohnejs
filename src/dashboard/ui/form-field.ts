import type { Child } from '../render/insert.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { onCleanup } from '../../utils/reactive/effect-scope.ts';
import { effect } from '../../utils/reactive/effect.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { when } from '../render/when.ts';
import { resolveText, type Text } from '../runtime/text.ts';
import { fieldLabel } from './field-label.ts';
import { fieldMessage } from './field-message.ts';
import { renderProse } from './prose.ts';
import './tokens.ts';

/**
 * Options for `formField`.
 */
export interface FormFieldOptions {
  /**
   * The label above the control.
   * A click on it focuses the control.
   */
  label?: Text;

  /**
   * Help under the control, rendered as Markdown prose.
   * An error takes its place while one shows.
   */
  description?: Text;

  /**
   * The control's reactive error message; an empty string or `undefined` shows none.
   * While one shows, it replaces the description and the control draws the destructive ring.
   */
  error?: () => string | undefined;

  /**
   * Draws the required asterisk after the label.
   * It only marks the field; checking the value is the caller's job.
   *
   * @default
   * false
   */
  required?: boolean;

  /**
   * Content at the right end of the label row, like a small button.
   */
  actions?: Child;

  /**
   * Size step of the component: -2 very small, -1 small, 0 default, 1 large, 2 very large.
   * Omitted inherits `--ohne-size` from the nearest ancestor.
   */
  size?: number;

  /**
   * Extra class names appended to the field's own.
   * `ohne-field-narrow` tightens the rhythm to a preceding field.
   */
  class?: string;
}

/**
 * The parts `fieldFrame` stacks: a label row, the control, and the message under it.
 */
export interface FieldFrame {
  /**
   * The label row's content: the label and anything beside it.
   * Omitted renders no label row.
   */
  head?: Child;

  /**
   * Draws the required asterisk after the label.
   */
  required?: boolean;

  /**
   * Builds the message shown while there is no error.
   */
  description?: () => Child;

  /**
   * The reactive error message; while non-empty it renders destructive in place of the description.
   */
  error?: () => string;

  /**
   * The id of the message's prose, the target of the control's `aria-describedby`.
   */
  messageID: string;

  /**
   * Extra class names appended to the field's own.
   */
  class?: string;

  /**
   * Size step of the field.
   */
  size?: number;
}

/**
 * Options for `fieldProse`.
 */
export interface FieldProseOptions {
  /**
   * The flow's class names.
   *
   * @default
   * 'ohne-prose'
   */
  class?: string;

  /**
   * Whether `[label](url)` renders a link, as `renderProse` reads it.
   *
   * @default
   * true
   */
  links?: boolean;
}

// Value controls first, so a chip's remove button or a drag handle never takes the label.
const CONTROL =
  "input:not([type='hidden']):not([hidden]), textarea, select, [contenteditable], [role]:is(button, [tabindex])";
// Disabled states included, since a control can be disabled when the field wires it.
const ANY_FOCUSABLE = "button, a[href], [tabindex]:not([tabindex='-1'])";

let sequence = 0;

/**
 * An `aria-*` attribute a field sets: its name, the value or `null` to drop it, and the field's own value.
 */
type Claim = [name: string, value: string | null, mine: string];

css`
  .ohne-field,
  .ohne-field-gate {
    width: 100%;
    font-size: calc(1rem + var(--ohne-size) * 0.125rem);
  }

  :where(
    :is(.ohne-field, .ohne-field-gate):not([hidden])
      + :is(.ohne-field, .ohne-field-gate):not([hidden])
  ) {
    margin-top: calc(1em + 0.125rem);
  }

  :where(.ohne-field:not([hidden]) + .ohne-field-narrow:not([hidden])) {
    margin-top: calc(0.5em + 0.125rem);
  }

  .ohne-field > * + * {
    margin-top: 0.5em;
  }

  .ohne-field .ohne-label {
    cursor: default;
  }

  .ohne-field-label .ohne-form-field-actions {
    display: flex;
    align-items: flex-end;
    gap: 0.5em;
    gap: round(0.5em, 1px);
    margin-left: auto;
    font-size: 1em;
  }
`;

/**
 * A Markdown flow under a control, re-rendered whenever `text` changes.
 * `formField` and `fieldRow` render their descriptions and errors through it.
 *
 * @example
 * ```ts
 * fieldProse(() => 'Use your **work** address', 'email-message')
 * ```
 */
export function fieldProse(
  text: () => string,
  id: string,
  options: FieldProseOptions = {},
): HTMLElement {
  const flow = h('div', { class: options.class ?? 'ohne-prose', id });
  effect(() => renderProse(flow, text(), { links: options.links ?? true }));
  return flow;
}

/**
 * The vertical stack every field renders through: the label row, the control, and the message.
 * It owns the size cascade and the spacing between its parts and between sibling fields.
 * The message shows the description, or the error in its place, both as prose.
 * An error can echo a submitted value, so a link in it renders as plain text.
 *
 * @example
 * ```ts
 * const head = h('span', { class: 'ohne-label' }, 'Name')
 * fieldFrame(textInput(name), { head, messageID: 'name-message' })
 * ```
 */
export function fieldFrame(control: Child, frame: FieldFrame): HTMLElement {
  const failure = (): string => frame.error?.() ?? '';
  const described = !isUndefined(frame.description);
  const message =
    isUndefined(frame.error) && !described
      ? null
      : when(
          () => failure() !== '' || described,
          () =>
            fieldMessage(
              () => {
                const current = failure();
                if (current !== '') {
                  return fieldProse(() => current, frame.messageID, { links: false });
                }
                return frame.description?.() ?? null;
              },
              { error: () => failure() !== '' },
            ),
        );
  return h(
    'div',
    {
      class: `ohne-field${isUndefined(frame.class) ? '' : ` ${frame.class}`}`,
      style: isUndefined(frame.size) ? undefined : `--ohne-size: ${frame.size}`,
    },
    isUndefined(frame.head) ? null : fieldLabel(frame.head, { required: frame.required }),
    control,
    message,
  );
}

/**
 * A labelled field around any control: the label row, the control, and the description or error under it.
 * It finds the control's first focusable element and wires it for assistive technology.
 * The element gets `aria-labelledby` for the label, `aria-describedby` for the message, and `aria-invalid`.
 * A click on the label focuses the element.
 * A control that mounts later, inside a `when`, is wired once it is inserted.
 * While an error shows, the control draws the destructive ring from its `aria-invalid`.
 * Without a label it is the bare stack, which spaces a button or a note like a field.
 *
 * @example
 * ```ts
 * const email = ref('')
 * formField(textInput(email, { type: 'email' }), {
 *   label: 'Email',
 *   description: 'Use your work address',
 *   error: () => (email.value.includes('@') ? '' : 'Enter an email address'),
 *   required: true,
 * })
 * ```
 */
export function formField(control: Child, options: FormFieldOptions = {}): HTMLElement {
  const { label, description, error, actions } = options;
  const id = `ohne-form-field-${++sequence}`;
  const labelID = `${id}-label`;
  const messageID = `${id}-message`;
  const failure = (): string => error?.() ?? '';
  const target = ref<HTMLElement | null>(null);

  const head =
    isUndefined(label) && isUndefined(actions)
      ? undefined
      : [
          isUndefined(label)
            ? null
            : h(
                'span',
                { class: 'ohne-label', id: labelID, onClick: () => target.value?.focus() },
                () => resolveText(label),
              ),
          isUndefined(actions) ? null : h('span', { class: 'ohne-form-field-actions' }, actions),
        ];

  const root = fieldFrame(control, {
    head,
    required: options.required,
    description: isUndefined(description)
      ? undefined
      : () => fieldProse(() => resolveText(description), messageID),
    error: isUndefined(error) ? undefined : failure,
    messageID,
    class: options.class,
    size: options.size,
  });

  if (isUndefined(label) && isUndefined(description) && isUndefined(error)) return root;

  const claims = (invalid: boolean): Claim[] => {
    const owned: Claim[] = [
      ['aria-describedby', invalid || !isUndefined(description) ? messageID : null, messageID],
    ];
    if (!isUndefined(label)) owned.push(['aria-labelledby', labelID, labelID]);
    if (!isUndefined(error)) owned.push(['aria-invalid', invalid ? 'true' : null, 'true']);
    return owned;
  };

  const rewire = (): void => {
    const current = untracked(() => target.value);
    if (!isNull(current) && root.contains(current)) return;
    if (!isNull(current)) {
      for (const [name, , mine] of claims(false)) claim(current, name, null, mine);
    }
    target.value = controlOf(root);
  };
  rewire();
  const observer = new MutationObserver(rewire);
  observer.observe(root, { childList: true, subtree: true });
  onCleanup(() => observer.disconnect());

  effect(() => {
    const element = target.value;
    if (isNull(element)) return;
    for (const [name, value, mine] of claims(failure() !== '')) claim(element, name, value, mine);
  });

  return root;
}

/**
 * The element a field's label addresses: the first value control, else the first focusable element.
 * The field's own label row and message never count.
 */
function controlOf(root: HTMLElement): HTMLElement | null {
  for (const selector of [CONTROL, ANY_FOCUSABLE]) {
    for (const element of root.querySelectorAll<HTMLElement>(selector)) {
      const part = element.closest('.ohne-field-label, .ohne-field-message');
      if (isNull(part) || !root.contains(part)) return element;
    }
  }
  return null;
}

/**
 * Sets the attribute `name` to `value`.
 * A `null` removes it, but only while it still holds `mine`, the value this field set.
 */
function claim(element: HTMLElement, name: string, value: string | null, mine: string): void {
  if (!isNull(value)) element.setAttribute(name, value);
  else if (element.getAttribute(name) === mine) element.removeAttribute(name);
}
