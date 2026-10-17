import { deepStrictEqual, strictEqual } from 'node:assert';
import { beforeEach, describe, it } from 'node:test';

import type { Hotkeys } from '../../../../src/dashboard/ui/hotkeys.ts';

import { hotkeyLabels } from '../../../../src/dashboard/ui/hotkey-match.ts';
import { effectScope, nextTick } from '../../../../src/utils/index.ts';
import { FakeElement, type FakeNode } from '../../../dashboard/_fake-dom.ts';
import { baseBrowser } from '../_browser.ts';
import { findAll, fire, recordListeners } from './_popups.ts';

/**
 * An element with an `id` that takes focus unless `disabled`, and knows its descendants.
 */
class FakeFocusable extends FakeElement {
  id = '';
  disabled = false;
  scrollTop = 0;
  focused = false;
  revealed: unknown[] = [];

  get isConnected(): boolean {
    const parent = this.parentNode;
    if (parent === (document.body as unknown as FakeNode)) return true;
    return parent instanceof FakeFocusable && parent.isConnected;
  }

  focus(): void {
    if (this.disabled) return;
    this.focused = true;
    Object.assign(document, { activeElement: this });
  }

  closest(selector: string): FakeElement | null {
    if (matches(this, selector)) return this;
    const parent = this.parentNode;
    return parent instanceof FakeFocusable ? parent.closest(selector) : null;
  }

  querySelector(selector: string): FakeElement | null {
    return this.querySelectorAll(selector)[0] ?? null;
  }

  querySelectorAll(selector: string): FakeElement[] {
    return findAll(this, (el) => matches(el, selector));
  }

  contains(other: FakeNode | null): boolean {
    let node = other;
    while (node && node !== this) node = node.parentNode;
    return node === this;
  }

  scrollIntoView(options: unknown): void {
    this.revealed.push(options);
  }

  hasAttribute(name: string): boolean {
    return this.getAttribute(name) !== null;
  }
}

/**
 * A text control with a selection, as an input or textarea has.
 */
class FakeTextControl extends FakeFocusable {
  value = '';
  selectionStart: number | null = 0;
  selectionEnd: number | null = 0;
  selectionDirection: string | null = 'none';

  setSelectionRange(start: number, end: number, direction = 'none'): void {
    this.selectionStart = start;
    this.selectionEnd = end;
    this.selectionDirection = direction;
  }
}

class FakeInput extends FakeTextControl {}

class FakeTextArea extends FakeTextControl {}

/**
 * Whether `el` matches each `tag[attribute]` alternative of `selector`, the forms the buttons query.
 */
function matches(el: FakeElement, selector: string): boolean {
  return selector.split(',').some((alternative) => {
    const [, tag, attribute] = /^(\w*)(?:\[([\w-]+)\])?$/.exec(alternative.trim()) ?? [];
    if (tag && el.tagName !== tag.toUpperCase()) return false;
    if (!attribute) return true;
    return attribute === 'id'
      ? (el as FakeFocusable).id !== ''
      : el.getAttribute(attribute) !== null;
  });
}

baseBrowser('/');
recordListeners();
const documentListeners = new Map<string, ((event: unknown) => void)[]>();
Object.assign(document, {
  addEventListener: (type: string, listener: (event: unknown) => void) =>
    documentListeners.set(type, [...(documentListeners.get(type) ?? []), listener]),
  removeEventListener() {},
});
const LINE_HEIGHT = 20;
Object.assign(FakeElement.prototype, {
  getBoundingClientRect(this: FakeElement) {
    const before = this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) - 1];
    const lines = this.tagName === 'SPAN' ? (before?.textContent.split('\n').length ?? 1) - 1 : 0;
    const top = lines * LINE_HEIGHT;
    return { top, bottom: top + LINE_HEIGHT, left: 0, right: 0, width: 0, height: LINE_HEIGHT };
  },
});
Object.assign(FakeElement.prototype, {
  append(this: FakeElement, ...nodes: (FakeElement | string)[]) {
    for (const node of nodes) {
      this.appendChild(
        (typeof node === 'string' ? document.createTextNode(node) : node) as FakeElement,
      );
    }
  },
});
Object.assign(globalThis, { HTMLInputElement: FakeInput, HTMLTextAreaElement: FakeTextArea });
const { isMac } = await import('../../../../src/dashboard/ui/hotkeys.ts');
const { History } = await import('../../../../src/base/dashboard/components/history.ts');
const { historyButtons } =
  await import('../../../../src/base/dashboard/components/history-buttons.ts');

type State = Record<string, string | string[]>;

/**
 * A `tag` element with `props`, holding `children`.
 */
function el<E extends FakeFocusable>(
  Kind: new (tag: string) => E,
  tag: string,
  props: Partial<E> & { attrs?: Record<string, string> } = {},
  ...children: FakeElement[]
): E {
  const { attrs = {}, ...rest } = props;
  const element = Object.assign(new Kind(tag), rest);
  for (const [name, value] of Object.entries(attrs)) element.setAttribute(name, value);
  for (const child of children) element.appendChild(child);
  return element;
}

/**
 * A field row `field-<name>` around a textarea control holding `value`.
 */
function textRow(name: string, value: string): FakeFocusable {
  return el(
    FakeFocusable,
    'div',
    { id: `field-${name}` },
    el(FakeTextArea, 'textarea', {
      id: `field-${name}-input`,
      value,
      attrs: { 'aria-labelledby': `field-${name}-label` },
    }),
  );
}

/**
 * A chips row `field-<name>`: one id-less remove button per chip, then the labelled text input.
 */
function chipsRow(name: string, chips: string[]): FakeFocusable {
  return el(
    FakeFocusable,
    'div',
    { id: `field-${name}` },
    ...chips.map((chip) =>
      el(FakeFocusable, 'button', {
        attrs: { class: 'chip-remove', 'aria-label': `Remove ${chip}` },
      }),
    ),
    el(FakeInput, 'input', { attrs: { 'aria-labelledby': `field-${name}-label` } }),
  );
}

describe('historyButtons', () => {
  let root: FakeFocusable;
  let stage: FakeFocusable;
  let undo!: (event?: unknown) => void;
  let redo!: (event?: unknown) => void;
  let toolbar: FakeElement;
  let history: InstanceType<typeof History<State>>;

  /**
   * Mounts the buttons over `states`, rendering each restored state through `build` into the stage.
   * A `patch` restores into the rendered tree in place instead.
   */
  const mount = (
    states: State[],
    build: (state: State) => FakeElement[],
    pending?: State,
    patch?: (state: State) => void,
  ): void => {
    history = new History<State>({ watchUnsavedChanges: false });
    for (const state of states) history.push(state);
    if (pending) void history.pushDebounced(pending, 1000);
    const hotkeys = {
      listen: (action: string, callback: () => void) => {
        if (action === 'undo') undo = callback;
        if (action === 'redo') redo = callback;
        return () => {};
      },
    } as unknown as Hotkeys;
    const render = (state: State): void => {
      stage.replaceChildren();
      for (const child of build(state)) stage.appendChild(child);
    };
    render(pending ?? states.at(-1)!);
    toolbar = effectScope().run(() =>
      historyButtons(history, patch ?? render, hotkeys),
    ) as unknown as FakeElement;
  };

  /**
   * The element `id` names under the root.
   */
  const byID = <E extends FakeElement = FakeTextArea>(id: string): E =>
    root.querySelectorAll('[id]').find((other) => (other as FakeFocusable).id === id) as E;

  /**
   * The element holding the focus.
   */
  const active = (): unknown => document.activeElement;

  /**
   * Focuses `element`, with a collapsed caret at `caret` when it holds text.
   */
  const focusOn = (element: FakeElement, caret?: number): void => {
    (element as FakeFocusable).focus();
    if (caret !== undefined) (element as FakeTextControl).setSelectionRange(caret, caret);
  };

  /**
   * Types into `control` as the browser does: a keydown, the new value, then the selection it leaves.
   * The host's debounced push follows, as a form's input handler sends it.
   */
  const typeInto = (control: FakeTextControl, value: string, caret: [number, number]): void => {
    for (const listener of documentListeners.get('keydown') ?? []) listener({ target: control });
    control.value = value;
    for (const listener of documentListeners.get('input') ?? []) listener({ target: control });
    control.setSelectionRange(...caret);
    void history.pushDebounced({ [control.id.replace(/^field-|-input$/g, '')]: value }, 1000);
  };

  beforeEach(() => {
    documentListeners.clear();
    stage = new FakeFocusable('div');
    root = el(FakeFocusable, 'main', {}, stage);
    (document.body as unknown as FakeElement).replaceChildren();
    (document.body as unknown as FakeElement).appendChild(root);
    Object.assign(document, {
      activeElement: document.body,
      getElementById: (id: string) => byID<FakeElement>(id) ?? null,
      querySelectorAll: (selector: string) => root.querySelectorAll(selector),
    });
  });

  it('puts the caret where undone typing started, as soon as the rebuild flushes', async () => {
    mount([{ body: 'hello world' }, { body: 'hello big world' }], ({ body }) => [
      textRow('body', body as string),
    ]);
    const before = byID('field-body-input');
    focusOn(before, 10);
    undo();
    await nextTick();
    const after = byID('field-body-input');
    strictEqual(after === before, false);
    strictEqual(after.focused, true);
    strictEqual(after.value, 'hello world');
    deepStrictEqual([after.selectionStart, after.selectionEnd], [6, 6]);
  });

  it('puts the caret behind text a redo puts back', async () => {
    mount([{ body: 'hello world' }, { body: 'hello big world' }], ({ body }) => [
      textRow('body', body as string),
    ]);
    focusOn(byID('field-body-input'), 10);
    undo();
    await nextTick();
    redo();
    await nextTick();
    const after = byID('field-body-input');
    strictEqual(after.value, 'hello big world');
    deepStrictEqual([after.selectionStart, after.selectionEnd], [10, 10]);
  });

  it('selects what an undo puts back where the user typed when the texts are ambiguous', async () => {
    mount([{ body: 'Lich King' }, { body: 'Lich Thing' }], ({ body }) => [
      textRow('body', body as string),
    ]);
    focusOn(byID('field-body-input'), 10);
    undo();
    await nextTick();
    const after = byID('field-body-input');
    deepStrictEqual([after.selectionStart, after.selectionEnd], [5, 9]);
  });

  it('selects the replaced text an undo puts back, and puts the caret behind the redone one', async () => {
    mount([{ title: 'The Fall of' }, { title: 'The Rise of' }], ({ title }) => [
      textRow('title', title as string),
    ]);
    focusOn(byID('field-title-input'), 8);
    undo();
    await nextTick();
    const undone = byID('field-title-input');
    deepStrictEqual(
      [undone.value, undone.selectionStart, undone.selectionEnd],
      ['The Fall of', 4, 8],
    );
    redo();
    await nextTick();
    const redone = byID('field-title-input');
    deepStrictEqual(
      [redone.value, redone.selectionStart, redone.selectionEnd],
      ['The Rise of', 8, 8],
    );
  });

  it('keeps the selection, its direction, and the scroll when the step left the text alone', async () => {
    mount(
      [
        { body: 'unchanged', other: '1' },
        { body: 'unchanged', other: '2' },
      ],
      ({ body }) => [textRow('body', body as string)],
    );
    const before = byID('field-body-input');
    before.focus();
    before.scrollTop = 40;
    before.setSelectionRange(2, 5, 'backward');
    undo();
    await nextTick();
    const after = byID('field-body-input');
    deepStrictEqual(
      [after.selectionStart, after.selectionEnd, after.selectionDirection, after.scrollTop],
      [2, 5, 'backward', 40],
    );
  });

  it('puts the caret at the end when the focused control had no selection', async () => {
    mount([{ body: 'a' }, { body: 'bc' }], ({ body }) => [textRow('body', body as string)]);
    const before = byID('field-body-input');
    before.focus();
    Object.assign(before, { selectionStart: null, selectionEnd: null });
    undo();
    await nextTick();
    deepStrictEqual(
      [byID('field-body-input').selectionStart, byID('field-body-input').focused],
      [1, true],
    );
  });

  describe('after a recorded burst of typing', () => {
    /**
     * Mounts `body` holding `value`, restored in place, and focuses it with `selection`.
     */
    const typed = (value: string, selection: [number, number]): FakeTextArea => {
      mount(
        [{ body: value }],
        ({ body }) => [textRow('body', body as string)],
        undefined,
        ({ body }) => (byID('field-body-input').value = body as string),
      );
      const control = byID('field-body-input');
      control.focus();
      control.setSelectionRange(...selection);
      return control;
    };

    it('selects exactly what the replaced text was, though it shares a letter with the new one', async () => {
      const control = typed('Arthas', [0, 6]);
      typeInto(control, 'A', [1, 1]);
      typeInto(control, 'Anduin', [6, 6]);
      await nextTick();
      undo();
      await nextTick();
      deepStrictEqual(
        [control.value, control.selectionStart, control.selectionEnd],
        ['Arthas', 0, 6],
      );
    });

    it('restores the selection an indent started from, and the one it left on redo', async () => {
      const control = typed('one\ntwo', [0, 7]);
      typeInto(control, '  one\n  two', [0, 11]);
      await nextTick();
      undo();
      await nextTick();
      deepStrictEqual([control.selectionStart, control.selectionEnd], [0, 7]);
      redo();
      await nextTick();
      deepStrictEqual([control.selectionStart, control.selectionEnd], [0, 11]);
    });

    it('falls back to the diff for a step no burst explains', async () => {
      const control = typed('Arthas', [0, 6]);
      typeInto(control, 'Anduin', [6, 6]);
      await nextTick();
      history.flush().push({ body: 'Anduin!' });
      control.value = 'Anduin!';
      undo();
      await nextTick();
      deepStrictEqual([control.selectionStart, control.selectionEnd], [6, 6]);
    });
  });

  it('scrolls the caret line into view inside the textarea, then in the panes around it', async () => {
    const lines = Array.from({ length: 150 }, (_, index) => `line ${index + 1}`).join('\n');
    mount(
      [{ body: 'line 1' }, { body: lines }],
      ({ body }) => [textRow('body', body as string)],
      undefined,
      ({ body }) => (byID('field-body-input').value = body as string),
    );
    const control = Object.assign(byID('field-body-input'), {
      clientHeight: 100,
      clientWidth: 300,
      clientTop: 1,
      offsetHeight: 102,
      scrollLeft: 0,
    });
    focusOn(control, 0);
    undo();
    await nextTick();
    control.scrollTop = 0;
    const margins: unknown[] = [];
    control.scrollIntoView = (options) =>
      margins.push([options, control.style.scrollMarginTop, control.style.scrollMarginBottom]);
    redo();
    await nextTick();
    strictEqual(control.scrollTop, 149 * LINE_HEIGHT + LINE_HEIGHT - 100);
    deepStrictEqual(margins, [[{ block: 'nearest' }, '-81px', '-1px']]);
  });

  describe('in a rebuilt list', () => {
    let key = 0;

    /**
     * One row per question, each under a fresh item key, as a rebuilt repeater renders them.
     */
    const questions = ({ faq }: State): FakeElement[] =>
      (faq as string[]).map((question) => {
        key += 1;
        return textRow(`faq[${key}].question`, question);
      });

    /**
     * The question controls in document order.
     */
    const controls = (): FakeTextArea[] =>
      root.querySelectorAll('textarea') as unknown as FakeTextArea[];

    it('finds a control again by its place when its item key changed', async () => {
      mount([{ faq: ['first', 'ab'] }, { faq: ['first', 'abc'] }], questions);
      focusOn(controls()[1]!, 3);
      undo();
      await nextTick();
      const [first, second] = controls();
      deepStrictEqual([first!.focused, second!.focused], [false, true]);
      deepStrictEqual([second!.value, second!.selectionStart], ['ab', 2]);
    });

    it('follows the focused text to the slot a reorder moved it to', async () => {
      mount([{ faq: ['Who', 'Where'] }, { faq: ['Where', 'Who'] }], questions);
      const before = controls()[0]!;
      before.focus();
      before.setSelectionRange(1, 3);
      undo();
      await nextTick();
      const [first, second] = controls();
      deepStrictEqual([first!.focused, second!.focused], [false, true]);
      deepStrictEqual(
        [second!.value, second!.selectionStart, second!.selectionEnd],
        ['Where', 1, 3],
      );
    });
  });

  describe('without an id on the focused element', () => {
    it('focuses the same part inside the nearest element with an id', async () => {
      mount([{ tags: ['a', 'b', 'c'] }, { tags: ['a', 'c'] }], ({ tags }) => [
        chipsRow('tags', tags as string[]),
      ]);
      focusOn(root.querySelectorAll('button')[1]!);
      undo();
      await nextTick();
      const buttons = root.querySelectorAll('button') as FakeFocusable[];
      deepStrictEqual(
        buttons.map((button) => button.focused),
        [false, false, true],
      );
    });

    it("focuses the row's control once that part is gone", async () => {
      mount([{ tags: ['a'] }, { tags: ['a', 'b'] }], ({ tags }) => [
        chipsRow('tags', tags as string[]),
      ]);
      focusOn(root.querySelectorAll('button')[1]!);
      undo();
      await nextTick();
      strictEqual((root.querySelector('input') as FakeInput).focused, true);
    });

    it("focuses the row's control when that part takes no focus", async () => {
      mount([{ tags: ['a'] }, { tags: ['a', 'b'] }], ({ tags }) => {
        const row = chipsRow('tags', tags as string[]);
        for (const button of row.querySelectorAll('button'))
          (button as FakeFocusable).disabled = true;
        return [row];
      });
      const before = root.querySelectorAll('button')[0] as FakeFocusable;
      before.disabled = false;
      focusOn(before);
      undo();
      await nextTick();
      strictEqual((root.querySelector('input') as FakeInput).focused, true);
    });

    it('refocuses nothing without an id on it or above it', async () => {
      const loose = el(FakeTextArea, 'textarea', { value: 'b' });
      mount(
        [
          { body: 'a', tags: ['x'] },
          { body: 'a', tags: [] },
        ],
        ({ body, tags }) => [textRow('body', body as string), chipsRow('tags', tags as string[])],
      );
      focusOn(loose);
      undo();
      await nextTick();
      deepStrictEqual(
        [byID('field-body-input').focused, (root.querySelector('input') as FakeInput).focused],
        [false, false],
      );
    });
  });

  it('scrolls a changed field into view when the focus stays in another one', async () => {
    mount(
      [
        { body: 'kept', tags: ['a'] },
        { body: 'kept', tags: ['a', 'b'] },
      ],
      ({ body, tags }) => [textRow('body', body as string), chipsRow('tags', tags as string[])],
    );
    focusOn(byID('field-body-input'), 4);
    undo();
    await nextTick();
    strictEqual(byID('field-body-input').focused, true);
    deepStrictEqual(byID<FakeFocusable>('field-tags').revealed, [{ block: 'nearest' }]);
  });

  it('scrolls the focused field into view when the step changed it in place', async () => {
    const input = el(FakeInput, 'input', { id: 'field-headline-input', value: 'ab' });
    const row = el(FakeFocusable, 'div', { id: 'field-headline' }, input);
    mount(
      [{ headline: 'a' }, { headline: 'ab' }],
      () => [row],
      undefined,
      ({ headline }) => (input.value = headline as string),
    );
    focusOn(input, 2);
    undo();
    await nextTick();
    deepStrictEqual([row.revealed, input.revealed], [[], [{ block: 'nearest' }]]);
  });

  describe('restoring in place', () => {
    /**
     * A list row `field-faq` with one item per question, keyed by position, then its add button.
     */
    const faqRow = (questions: string[]): FakeFocusable =>
      el(
        FakeFocusable,
        'div',
        { id: 'field-faq' },
        ...questions.map((question, index) => textRow(`faq[${index + 1}].question`, question)),
        el(FakeFocusable, 'button', { attrs: { 'aria-label': 'Add item' } }),
      );

    /**
     * Drops every item of the rendered `field-faq` whose question `state` no longer holds.
     */
    const dropMissing = ({ faq }: State): void => {
      for (const control of root.querySelectorAll('textarea') as FakeTextArea[]) {
        if (!(faq as string[]).includes(control.value)) control.parentElement!.remove();
      }
    };

    it('moves focus to the sibling field whose text the step changed, the caret at the change', async () => {
      mount(
        [{ faq: ['Who', 'x'] }, { faq: ['Who won', 'x'] }],
        ({ faq }) => [
          el(
            FakeFocusable,
            'div',
            { id: 'field-faq' },
            textRow('faq[1].question', (faq as string[])[0]!),
            textRow('faq[1].answer', (faq as string[])[1]!),
          ),
        ],
        undefined,
        ({ faq }) => (byID('field-faq[1].question-input').value = (faq as string[])[0]!),
      );
      byID('field-faq[1].question-input').setSelectionRange(7, 7);
      focusOn(byID('field-faq[1].answer-input'), 1);
      undo();
      await nextTick();
      const question = byID('field-faq[1].question-input');
      deepStrictEqual(
        [question.focused, active() === question, question.selectionStart],
        [true, true, 3],
      );
      deepStrictEqual(question.revealed, [{ block: 'nearest' }]);
    });

    it('keeps the focus on a control whose own field holds the change', async () => {
      const toggle = el(FakeFocusable, 'button', {
        id: 'field-social-input',
        attrs: { 'aria-labelledby': 'field-social-label' },
      });
      const row = el(FakeFocusable, 'div', { id: 'field-social' }, toggle);
      mount(
        [{ social: ['bob'] }, { social: [] }],
        () => [row],
        undefined,
        ({ social }) => {
          if ((social as string[]).length > 0) row.appendChild(textRow('social.handle', 'bob'));
        },
      );
      focusOn(toggle);
      undo();
      await nextTick();
      deepStrictEqual([toggle.focused, active() === toggle], [true, true]);
      deepStrictEqual(toggle.revealed, [{ block: 'nearest' }]);
    });

    it('focuses the same control in the item before a removed focused item', async () => {
      mount(
        [{ faq: ['A', 'C'] }, { faq: ['A', 'B', 'C'] }],
        ({ faq }) => [faqRow(faq as string[])],
        undefined,
        dropMissing,
      );
      focusOn(byID('field-faq[2].question-input'), 1);
      undo();
      await nextTick();
      deepStrictEqual(
        [
          active() === byID('field-faq[1].question-input'),
          byID('field-faq[1].question-input').selectionStart,
        ],
        [true, 1],
      );
    });

    it('focuses the add button once the removed focused item was the last', async () => {
      mount(
        [{ faq: ['A'] }, { faq: ['A', 'B'] }],
        ({ faq }) => [faqRow(faq as string[])],
        undefined,
        dropMissing,
      );
      focusOn(byID('field-faq[2].question-input'), 1);
      undo();
      await nextTick();
      strictEqual((active() as FakeElement).getAttribute('aria-label'), 'Add item');
    });

    it('moves focus into an item a redo puts back, the caret behind its text', async () => {
      const row = faqRow(['A']);
      mount(
        [{ faq: ['A'] }, { faq: ['A', 'B'] }],
        () => [row],
        undefined,
        ({ faq }) => {
          dropMissing({ faq });
          if ((faq as string[]).length === 2)
            row.insertBefore(textRow('faq[3].question', 'B'), row.childNodes.at(-1)!);
        },
      );
      undo();
      await nextTick();
      focusOn(root.querySelectorAll('button').at(-1)!);
      redo();
      await nextTick();
      const question = byID('field-faq[3].question-input');
      deepStrictEqual([active() === question, question.selectionStart], [true, 1]);
    });
  });

  it('names the platform shortcut in each tooltip, and shows it while the button is disabled', () => {
    mount([{ body: 'a' }, { body: 'b' }], ({ body }) => [textRow('body', body as string)]);
    const [undoWrap, redoWrap] = toolbar.childNodes as FakeElement[];
    const tooltips = (): FakeElement[] =>
      findAll(document.body as unknown as FakeElement, (element) =>
        (element.getAttribute('class') ?? '').includes('ohne-tooltip-content'),
      );
    fire(redoWrap!, 'mouseenter');
    deepStrictEqual(
      tooltips().map((tooltip) => tooltip.textContent),
      [`dashboard.history.redo 0${hotkeyLabels(isMac()).redo}`],
    );
    fire(redoWrap!, 'mouseleave');
    fire(undoWrap!, 'mouseenter');
    deepStrictEqual(tooltips(), []);
  });

  it('steps a pending push back from the buttons, which never take focus', async () => {
    mount([{ body: 'a' }], ({ body }) => [textRow('body', body as string)], { body: 'ab' });
    focusOn(byID('field-body-input'), 2);
    let prevented = false;
    fire(toolbar, 'mousedown', { preventDefault: () => (prevented = true) });
    strictEqual(prevented, true);
    const [undoButton] = findAll(toolbar, (element) => element.tagName === 'BUTTON');
    strictEqual(undoButton!.getAttribute('disabled'), null);
    fire(undoButton!, 'click');
    await nextTick();
    deepStrictEqual(
      [byID('field-body-input').value, byID('field-body-input').focused],
      ['a', true],
    );
  });

  it('leaves the keystroke to the browser when there is no step to take', () => {
    mount([{ body: 'a' }], ({ body }) => [textRow('body', body as string)]);
    let prevented = false;
    undo({ preventDefault: () => (prevented = true) });
    strictEqual(prevented, false);
  });
});
