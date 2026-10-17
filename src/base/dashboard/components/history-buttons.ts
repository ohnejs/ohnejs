import type { Hotkeys, IconName } from 'ohnejs/dashboard';

import {
  attachTooltip,
  button,
  controlIDs,
  css,
  h,
  hotkeyLabels,
  isMac,
  useHotkeys,
  useT,
} from 'ohnejs/dashboard';
import {
  deepEqual,
  editRange,
  effect,
  isNull,
  isNullish,
  isUndefined,
  nextTick,
  onCleanup,
  stripCodeSpans,
} from 'ohnejs/utils';

import type { History } from './history.ts';

/**
 * Which way a step goes.
 */
type Direction = 'undo' | 'redo';

/**
 * What a text control held: its text, its selection and its scroll.
 */
interface Typed {
  value: string;
  start: number | null;
  end: number | null;
  direction: 'forward' | 'backward' | 'none' | null;
  scrollTop: number;
}

/**
 * One burst of typing in a text control: what it held before its first input and after its last.
 */
interface Edit {
  key: HTMLElement | string;
  before: Typed;
  after: Typed;
}

/**
 * Where focus sits: the element, its nearest `id`, the elements of that id's shape, its part and its text.
 */
interface Focus {
  element: HTMLElement;
  anchor: string;
  shape: string;
  peers: HTMLElement[];
  nth: number;
  part: string | undefined;
  index: number;
  typed: Typed | undefined;
}

const ITEM_KEY = /\[\d+\]/g;

const LAST_ITEM_KEY = /\[\d+\][^[]*$/;

const FOCUSABLE = 'a[href], button, input, select, textarea, [contenteditable], [tabindex]';

const EDITS_KEPT = 100;

const MIRRORED = [
  'direction',
  'font-family',
  'font-feature-settings',
  'font-size',
  'font-stretch',
  'font-style',
  'font-variant',
  'font-variation-settings',
  'font-weight',
  'letter-spacing',
  'line-height',
  'overflow-wrap',
  'padding-bottom',
  'padding-left',
  'padding-right',
  'padding-top',
  'tab-size',
  'text-indent',
  'text-transform',
  'white-space',
  'word-break',
  'word-spacing',
];

css`
  .o-history-button {
    display: inline-flex;
  }
`;

/**
 * The undo and redo button pair for a `History` instance.
 *
 * It binds the `undo` and `redo` hotkeys on `hotkeys`, which by default listens on `document`.
 * The default fires while typing too, so a history with a step to take owns undo and redo.
 * With none, the browser's own text undo runs.
 * A popup passes its own root-targeted instance, since keydowns stop at a popup root.
 * `restore` receives the state returned by `history.undo()`/`history.redo()`, only when one came back.
 * Each button's tooltip names its platform shortcut, and shows while the button is disabled too.
 * The buttons never take focus, so a click steps like the hotkey from the control being edited.
 *
 * Focus follows the change as soon as the restore flushes, before anything paints.
 * A step that rewrote the text of another input or textarea moves focus there and scrolls it into view.
 * A focused control that takes no text keeps the focus while its own field holds the change, like a switch.
 * A focused element the step did not rebuild otherwise stays the one focused.
 * A control without an `id` is found again by its tag and label inside the nearest element with one.
 * If none of those is left to take focus, the row control inside that element does.
 * A rebuilt list item gets fresh keys, so its control is found by the text it holds, else by its place.
 * A step that removed the focused list item focuses the item before it, or the list's last button.
 * When it was the last item, that button is the one that added it.
 * In text the step changed, an undo restores the selection its edit started from, a redo the one it left.
 * Each burst of typing records both, from the keydown or `beforeinput` before its first input.
 * Without a recorded burst, an undo selects what it put back and a redo puts the caret behind it.
 * Text the step left alone keeps its selection and scroll.
 * The caret of the changed text scrolls into view, inside its control and in the panes around it.
 * The focused control scrolls into view when its field changed, else the first changed field does.
 * Create it inside a reactive region; the hotkey and edit listeners and the tooltips die with it.
 */
export function historyButtons<T extends object>(
  history: History<T>,
  restore: (state: T) => void,
  hotkeys: Hotkeys = useHotkeys({ allowInOverlays: true, allowWhileTyping: ['undo', 'redo'] }),
): HTMLElement {
  const t = useT();
  const shortcuts = hotkeyLabels(isMac());
  const edits: Edit[] = [];
  let seen: { el: HTMLElement; typed: Typed } | undefined;
  let open: Edit | undefined;

  const note = (event: Event): void => {
    const el = event.target;
    if (el instanceof Element && isTyping(el)) seen = { el, typed: typedOf(el) };
  };
  const record = (event: Event): void => {
    const el = event.target;
    if (!(el instanceof Element) || !isTyping(el) || seen?.el !== el) return;
    if (open?.key !== keyOf(el) || !history.isPending()) {
      open = { key: keyOf(el), before: seen.typed, after: seen.typed };
      edits.push(open);
      if (edits.length > EDITS_KEPT) edits.shift();
    }
    const edit = open;
    // A control may set its own selection once its input handler returns, as an indent does.
    queueMicrotask(() => (edit.after = typedOf(el)));
  };
  const listeners = [
    ['keydown', note],
    ['beforeinput', note],
    ['input', record],
  ] as const;
  for (const [type, listener] of listeners) document.addEventListener(type, listener, true);
  onCleanup(() => {
    for (const [type, listener] of listeners) document.removeEventListener(type, listener, true);
  });

  const recorded = (
    key: HTMLElement | string,
    was: string,
    now: string,
    direction: Direction,
  ): Typed | undefined => {
    const crossed = ({ before, after }: Edit): boolean =>
      direction === 'undo'
        ? after.value === was && before.value === now
        : before.value === was && after.value === now;
    const edit = edits.findLast((edit) => edit.key === key && crossed(edit));
    return direction === 'undo' ? edit?.before : edit?.after;
  };

  const step = (direction: Direction, event?: KeyboardEvent): void => {
    history.flush();
    const from = history.getCurrentState();
    const state = direction === 'undo' ? history.undo() : history.redo();
    if (isUndefined(state)) return;
    event?.preventDefault();
    const keys = changedKeys(from, state);
    const typed = new Map(typingIn(rowsOf(keys)).map((el) => [keyOf(el), typedOf(el)]));
    const focused = focusOf(document.activeElement);
    restore(state);
    void nextTick().then(() => {
      const changed = typingIn(rowsOf(keys)).filter((el) => {
        const was = typed.get(keyOf(el));
        return isUndefined(was) ? el.id !== '' : was.value !== el.value;
      });
      const target = followed(focused, changed);
      target?.focus({ preventScroll: true });
      if (!isUndefined(target) && document.activeElement === target) {
        const was = typed.get(keyOf(target));
        const edit = isUndefined(was)
          ? undefined
          : recorded(keyOf(target), was.value, target.value, direction);
        place(target, was, direction, edit);
        revealCaret(target);
        return;
      }
      if (!isUndefined(focused)) refocus(focused, direction);
      reveal(rowsOf(keys));
    });
  };

  hotkeys.listen('undo', (event) => step('undo', event));
  hotkeys.listen('redo', (event) => step('redo', event));

  const control = (
    direction: Direction,
    glyph: IconName,
    count: () => number,
    disabled: () => boolean,
  ): HTMLElement => {
    const label = (): string => `${t(`dashboard.history.${direction}`)} \`${count()}\``;
    const tip = (): string => `${label()}<br>\`${shortcuts[direction]}\``;
    const wrap = h(
      'span',
      { class: 'o-history-button' },
      button(tip, {
        icon: glyph,
        iconOnly: true,
        variant: 'outline',
        disabled,
        ariaLabel: () => stripCodeSpans(label()),
        onClick: () => step(direction),
      }),
    );
    // A disabled button takes no pointer events, so its wrapper carries the tooltip meanwhile.
    let detach: (() => void) | undefined;
    effect(() => {
      detach?.();
      detach = disabled() ? attachTooltip(wrap, tip) : undefined;
    });
    onCleanup(() => detach?.());
    return wrap;
  };

  return h(
    'div',
    {
      class: 'o-history-buttons ohne-row',
      onMousedown: (event: MouseEvent) => event.preventDefault(),
    },
    control(
      'undo',
      'arrow-back-up',
      () => history.undoCount.value,
      () => !history.canUndo.value,
    ),
    control(
      'redo',
      'arrow-forward-up',
      () => history.redoCount.value,
      () => !history.canRedo.value,
    ),
  );
}

/**
 * Whether `el` is an input or textarea.
 */
function isTextControl(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

/**
 * Whether `el` is an input or textarea that holds a caret, unlike a checkbox.
 */
function isTyping(el: Element): el is HTMLInputElement | HTMLTextAreaElement {
  return isTextControl(el) && !isNull(el.selectionStart);
}

/**
 * The top-level keys whose values differ between `from` and `to`.
 */
function changedKeys(from: object | undefined, to: object): string[] {
  const before = (from ?? {}) as Record<string, unknown>;
  const after = to as Record<string, unknown>;
  return Object.keys({ ...before, ...after }).filter((key) => !deepEqual(before[key], after[key]));
}

/**
 * The field rows of `keys` on the page, in key order.
 */
function rowsOf(keys: string[]): HTMLElement[] {
  return keys
    .map((key) => document.getElementById(controlIDs(key).row))
    .filter((row) => !isNull(row));
}

/**
 * Every shown input and textarea holding a caret inside `rows`, in document order.
 */
function typingIn(rows: HTMLElement[]): (HTMLInputElement | HTMLTextAreaElement)[] {
  return rows.flatMap((row) =>
    [...row.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')].filter(
      (el) => isTyping(el) && !el.hidden,
    ),
  );
}

/**
 * What finds `el` again across a restore: its `id`, which a rebuilt control keeps, else the element.
 */
function keyOf(el: HTMLElement): HTMLElement | string {
  return el.id === '' ? el : el.id;
}

/**
 * The text, selection and scroll `el` holds.
 */
function typedOf(el: HTMLInputElement | HTMLTextAreaElement): Typed {
  return {
    value: el.value,
    start: el.selectionStart,
    end: el.selectionEnd,
    direction: el.selectionDirection,
    scrollTop: el.scrollTop,
  };
}

/**
 * The control among `changed` that focus moves to, or `undefined` when it stays where `focused` is.
 * That is the focused control when its own text changed, else the first of them.
 * A focused control that takes no text keeps the focus while its own field holds the change.
 */
function followed<E extends HTMLElement>(focused: Focus | undefined, changed: E[]): E | undefined {
  const own = changed.find((el) => el === focused?.element || el.id === focused?.anchor);
  if (!isUndefined(own)) return own;
  const [first] = changed;
  if (isUndefined(first) || isUndefined(focused)) return first;
  const { element } = focused;
  const holds =
    element.isConnected &&
    !isTyping(element) &&
    element.hasAttribute('aria-labelledby') &&
    element.parentElement?.closest('[id]')?.contains(first) === true;
  return holds ? undefined : first;
}

/**
 * The `Focus` of `el`, or `undefined` when neither it nor an ancestor has an `id` to find it by.
 */
function focusOf(el: Element | null): Focus | undefined {
  const anchor = el?.closest<HTMLElement>('[id]');
  if (isNullish(el) || isNullish(anchor)) return undefined;
  const shape = shapeOf(anchor.id);
  const peers = sameShape(shape);
  const part = el === anchor ? undefined : partOf(el);
  return {
    element: el as HTMLElement,
    anchor: anchor.id,
    shape,
    peers,
    nth: peers.indexOf(anchor),
    part,
    index: isUndefined(part) ? 0 : partsOf(anchor, part).indexOf(el as HTMLElement),
    typed: isTyping(el) ? typedOf(el) : undefined,
  };
}

/**
 * Focuses the element `focus` names and puts its caret back.
 */
function refocus(focus: Focus, direction: Direction): void {
  const gone = !focus.element.isConnected;
  const shrunk =
    gone &&
    isNull(document.getElementById(focus.anchor)) &&
    sameShape(focus.shape).length < focus.peers.length;
  const el = shrunk ? removed(focus) : gone ? relocate(focus) : focus.element;
  if (isUndefined(el)) return;
  el.focus();
  place(el, shrunk ? undefined : focus.typed, direction);
}

/**
 * Sets the selection of `el` after a step, from what it held before it.
 * Changed text gets the selection of the recorded `edit` the step crossed, when there is one.
 * Without one it gets the range the step wrote on undo and the caret behind it on redo.
 * Unchanged text keeps its selection and scroll; text not held before gets the caret at its end.
 */
function place(
  el: HTMLElement,
  typed: Typed | undefined,
  direction: Direction,
  edit?: Typed,
): void {
  if (!isTyping(el)) return;
  const { value } = el;
  if (!isUndefined(edit) && !isNull(edit.start)) {
    el.setSelectionRange(edit.start, edit.end ?? edit.start, edit.direction ?? undefined);
    return;
  }
  if (isUndefined(typed) || isNull(typed.start)) {
    el.setSelectionRange(value.length, value.length);
    return;
  }
  if (typed.value !== value) {
    const { start, end } = editRange(typed.value, value, typed.end ?? typed.start);
    el.setSelectionRange(direction === 'undo' ? start : end, end);
    return;
  }
  el.setSelectionRange(typed.start, typed.end ?? typed.start, typed.direction ?? undefined);
  // After the selection, which scrolls the caret into view.
  el.scrollTop = typed.scrollTop;
}

/**
 * Focuses and returns what `focus` names in a rebuilt tree: its part, else the anchor's row control.
 * A part can be there yet take no focus, like an item action shown only on hover, so each one is tried.
 */
function relocate(focus: Focus): HTMLElement | undefined {
  const anchor = anchorOf(focus);
  if (isUndefined(anchor)) return undefined;
  const parts = isUndefined(focus.part) ? [anchor] : partsOf(anchor, focus.part);
  return (
    [parts[focus.index], parts[0], anchor.querySelector<HTMLElement>('[aria-labelledby]')].find(
      (el) => !isNullish(el) && takesFocus(el),
    ) ?? undefined
  );
}

/**
 * Focuses `el` and says whether it took the focus.
 */
function takesFocus(el: HTMLElement): boolean {
  el.focus();
  return document.activeElement === el;
}

/**
 * The element `focus` was anchored to, found again by its `id`, else among the same-shaped ids.
 * A list the step reordered moves the focused text to another slot, so the text it held is looked for there.
 */
function anchorOf(focus: Focus): HTMLElement | undefined {
  const exact = document.getElementById(focus.anchor);
  if (!isNull(exact)) return exact;
  const peers = sameShape(focus.shape);
  const slot = peers[focus.nth];
  const holds = (el: HTMLElement | undefined): boolean =>
    !isUndefined(el) && isTextControl(el) && el.value === focus.typed?.value;
  if (!isUndefined(focus.part) || isUndefined(focus.typed) || holds(slot)) return slot;
  return peers.find(holds) ?? slot;
}

/**
 * Focuses and returns what takes the place of the focused list item a step removed.
 * That is the same control in the item before it, else in the one after it, else that item's row control.
 * When the item was the list's last, it is the list's last button that takes focus, its add action.
 */
function removed(focus: Focus): HTMLElement | undefined {
  const list = document.getElementById(focus.anchor.replace(LAST_ITEM_KEY, ''));
  if (isNull(list)) return undefined;
  const sibling = (el: HTMLElement): boolean => el.isConnected && list.contains(el);
  const after = focus.peers.slice(focus.nth + 1).find(sibling);
  if (isUndefined(after)) {
    return [...list.querySelectorAll<HTMLElement>('button')].reverse().find(takesFocus);
  }
  const peer = focus.peers.slice(0, focus.nth).reverse().find(sibling) ?? after;
  return (
    [peer, peer.querySelector<HTMLElement>('[aria-labelledby]')].find(
      (el) => !isNull(el) && takesFocus(el),
    ) ?? undefined
  );
}

/**
 * Scrolls the focused element into view when one of `rows` holds it, else the first of them.
 */
function reveal(rows: HTMLElement[]): void {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !rows.some((row) => row.contains(active))) {
    rows[0]?.scrollIntoView({ block: 'nearest' });
    return;
  }
  if (isTyping(active)) revealCaret(active);
  else active.scrollIntoView({ block: 'nearest' });
}

/**
 * Scrolls the line holding the caret of `el` into view, inside a textarea and then in each pane around it.
 * An input scrolls into view whole.
 */
function revealCaret(el: HTMLInputElement | HTMLTextAreaElement): void {
  if (!(el instanceof HTMLTextAreaElement)) {
    el.scrollIntoView({ block: 'nearest' });
    return;
  }
  const { top, bottom, left } = caretLine(el);
  const style = getComputedStyle(el);
  const padding = (side: string): number =>
    Number.parseFloat(style.getPropertyValue(`padding-${side}`)) || 0;
  el.scrollTop = Math.min(
    top - padding('top'),
    Math.max(el.scrollTop, bottom + padding('bottom') - el.clientHeight),
  );
  el.scrollLeft = Math.min(
    left - padding('left'),
    Math.max(el.scrollLeft, left + padding('right') - el.clientWidth),
  );
  // The margins shrink the box `scrollIntoView` reveals to the caret's line.
  const shown = el.clientTop + top - el.scrollTop;
  const { scrollMarginTop, scrollMarginBottom } = el.style;
  el.style.scrollMarginTop = `${-shown}px`;
  el.style.scrollMarginBottom = `${shown + bottom - top - el.offsetHeight}px`;
  el.scrollIntoView({ block: 'nearest' });
  Object.assign(el.style, { scrollMarginTop, scrollMarginBottom });
}

/**
 * Where the line holding the caret of `area` sits in its scrolled content, measured on a hidden copy of it.
 */
function caretLine(area: HTMLTextAreaElement): { top: number; bottom: number; left: number } {
  const style = getComputedStyle(area);
  const copy = document.createElement('div');
  copy.style.cssText =
    MIRRORED.map((name) => `${name}: ${style.getPropertyValue(name)}; `).join('') +
    `position: fixed; top: 0; left: 0; visibility: hidden; box-sizing: border-box; border: 0; ` +
    `width: ${area.clientWidth}px`;
  const caret = document.createElement('span');
  caret.style.cssText = 'display: inline-block; height: 1lh; vertical-align: top';
  const at = area.selectionDirection === 'backward' ? area.selectionStart : area.selectionEnd;
  copy.append(area.value.slice(0, at), caret);
  document.body.append(copy);
  const origin = copy.getBoundingClientRect();
  const box = caret.getBoundingClientRect();
  copy.remove();
  return {
    top: box.top - origin.top,
    bottom: box.bottom - origin.top,
    left: box.left - origin.left,
  };
}

/**
 * What tells `el` apart from its siblings when it has no `id`: its tag and accessible label.
 * Classes are left out, since they carry state like disabled or active that a step can change.
 */
function partOf(el: Element): string {
  return `${el.tagName}|${el.getAttribute('aria-label') ?? ''}`;
}

/**
 * Every focusable element inside `anchor` whose `partOf` is `part`, in document order.
 */
function partsOf(anchor: HTMLElement, part: string): HTMLElement[] {
  return [...anchor.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => partOf(el) === part);
}

/**
 * An element `id` with its list item keys blanked, the same for one field in the same item slot.
 */
function shapeOf(id: string): string {
  return id.replace(ITEM_KEY, '[]');
}

/**
 * Every element whose `id` has `shape`, in document order.
 */
function sameShape(shape: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[id]')].filter(
    (el) => shapeOf(el.id) === shape,
  );
}
