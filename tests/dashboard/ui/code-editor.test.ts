import { deepStrictEqual, notStrictEqual, ok, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type { Ref } from '../../../src/utils/reactive/ref.ts';

import { detectPlatform } from '../../../src/utils/keys/platform.ts';
import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const sheets: string[] = [];
Object.assign(CSSStyleSheet.prototype, {
  replaceSync: (text: string) => sheets.push(text),
});

const { codeEditor, HIGHLIGHT_LIMIT } = await import('../../../src/dashboard/ui/code-editor.ts');

type CodeEditorOptions = NonNullable<Parameters<typeof codeEditor>[1]>;

/**
 * The textarea with the selection and the `setRangeText` fallback the editor's edits go through.
 */
interface Area extends FakeElement {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  setSelectionRange(start: number, end: number): void;
  blur(): void;
}

const MOD = detectPlatform() === 'mac' ? 'metaKey' : 'ctrlKey';

/**
 * Builds an editor over `source` and returns its frame, its textarea and the twin's line sheet.
 */
function mount(source: Ref<string>, options?: CodeEditorOptions) {
  const root = codeEditor(source, options) as unknown as FakeElement;
  const area = findElement(root, (element) => element.tagName === 'TEXTAREA') as Area;
  const view = findElement(root, (element) => hasClass(element, 'ohne-code-lines')) as FakeElement;
  Object.assign(area, {
    selectionStart: 0,
    selectionEnd: 0,
    setSelectionRange(start: number, end: number) {
      area.selectionStart = start;
      area.selectionEnd = end;
    },
    setRangeText(text: string, from: number, to: number) {
      area.value = area.value.slice(0, from) + text + area.value.slice(to);
    },
    dispatchEvent(event: Event) {
      fire(area, event.type);
      return true;
    },
    blur() {},
  });
  flush();
  return { root, area, view };
}

/**
 * Fires a keydown for `key` on `area` with no modifiers unless `init` sets some.
 */
function press(area: Area, key: string, init: Record<string, unknown> = {}) {
  return fire(area, 'keydown', {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    isComposing: false,
    keyCode: 0,
    ...init,
  });
}

/**
 * The `[class, text]` of every span in `line`, in order.
 */
const spansOf = (line: FakeElement): [string | null, string][] =>
  line.childNodes
    .filter((node): node is FakeElement => node instanceof FakeElement)
    .map((span) => [span.getAttribute('class'), span.textContent]);

describe('codeEditor', () => {
  it('writes typing into the model and the model into the textarea', () => {
    const source = ref('a');
    const { area } = mount(source);
    strictEqual(area.value, 'a');
    area.value = 'ab';
    fire(area, 'input');
    strictEqual(source.value, 'ab');
    source.value = 'abc';
    flush();
    strictEqual(area.value, 'abc');
  });

  it("puts the twin at the textarea's scroll after a value write", () => {
    const source = ref('a\nb');
    const { root, area } = mount(source);
    const twin = findElement(root, (element) =>
      hasClass(element, 'ohne-code-view'),
    ) as FakeElement & {
      scrollTop: number;
    };
    Object.assign(area, { scrollTop: 2772, scrollLeft: 0 });
    Object.assign(twin, { scrollTop: 2787, scrollLeft: 0 });
    source.value = 'a\nb\nc';
    flush();
    strictEqual(twin.scrollTop, 2772);
  });

  it('keeps the browser from anchoring the twin on its own', () => {
    ok(sheets.some((text) => /\.ohne-code-view \{[^}]*overflow-anchor: none;/.test(text)));
  });

  it('renders one line element per line, the empty ones included', () => {
    const source = ref('');
    const { view } = mount(source);
    deepStrictEqual(
      view.childNodes.map((line) => line.textContent),
      [''],
    );
    source.value = 'a\nb\n';
    flush();
    deepStrictEqual(
      view.childNodes.map((line) => line.textContent),
      ['a', 'b', ''],
    );
  });

  it('wraps each token in a span and splits one at every newline', () => {
    const { view } = mount(ref('/* a\nb */ 1'), { language: 'ts' });
    const [first, second] = view.childNodes as FakeElement[];
    deepStrictEqual(spansOf(first), [['tk-comment', '/* a']]);
    deepStrictEqual(spansOf(second), [
      ['tk-comment', 'b */'],
      ['tk-number', '1'],
    ]);
    strictEqual(second.textContent, 'b */ 1');
  });

  it('rebuilds only the lines whose text or tokens changed', () => {
    const source = ref('a\nb\nc');
    const { view } = mount(source, { language: 'ts' });
    const [first, second, third] = view.childNodes;
    source.value = 'a\nbx\nc';
    flush();
    strictEqual(view.childNodes[0], first);
    notStrictEqual(view.childNodes[1], second);
    strictEqual(view.childNodes[1]?.textContent, 'bx');
    strictEqual(view.childNodes[2], third);
    source.value = '/*a\nbx\nc';
    flush();
    notStrictEqual(view.childNodes[2], third);
    deepStrictEqual(spansOf(view.childNodes[2] as FakeElement), [['tk-comment', 'c']]);
  });

  it('inserts the indent unit on Tab and indents a selection that spans lines', () => {
    const source = ref('a\nb');
    const { area } = mount(source);
    area.setSelectionRange(1, 1);
    ok(press(area, 'Tab').defaultPrevented);
    strictEqual(source.value, 'a  \nb');
    deepStrictEqual([area.selectionStart, area.selectionEnd], [3, 3]);
    area.setSelectionRange(0, 5);
    press(area, 'Tab');
    strictEqual(source.value, '  a  \n  b');
    deepStrictEqual([area.selectionStart, area.selectionEnd], [0, 9]);
  });

  it('outdents on Shift+Tab and mod+[, indents on mod+]', () => {
    const source = ref('  a\n\tb');
    const { area } = mount(source);
    area.setSelectionRange(0, 6);
    press(area, 'Tab', { shiftKey: true });
    strictEqual(source.value, 'a\nb');
    press(area, ']', { [MOD]: true });
    strictEqual(source.value, '  a\n  b');
    press(area, '[', { [MOD]: true });
    strictEqual(source.value, 'a\nb');
  });

  it('inserts a tab under `indent: "tab"` and renders it four columns wide', () => {
    const source = ref('a');
    const { root, area } = mount(source, { indent: 'tab' });
    ok(root.getAttribute('style')?.includes('tab-size: 4'));
    area.setSelectionRange(0, 0);
    press(area, 'Tab');
    strictEqual(source.value, '\ta');
  });

  it('keeps the line indent on Enter', () => {
    const source = ref('  a');
    const { area } = mount(source);
    area.setSelectionRange(3, 3);
    press(area, 'Enter');
    strictEqual(source.value, '  a\n  ');
    deepStrictEqual([area.selectionStart, area.selectionEnd], [6, 6]);
  });

  it('leaves a key to the input method while composing', () => {
    const source = ref('a');
    const { area } = mount(source);
    ok(!press(area, 'Tab', { isComposing: true }).defaultPrevented);
    ok(!press(area, 'Enter', { keyCode: 229 }).defaultPrevented);
    strictEqual(source.value, 'a');
  });

  it('blurs on Escape', () => {
    const { area } = mount(ref(''));
    let blurred = false;
    area.blur = () => {
      blurred = true;
    };
    ok(press(area, 'Escape').defaultPrevented);
    ok(blurred);
  });

  it('follows a language getter', () => {
    const language = ref('text');
    const { view } = mount(ref('const a = 1'), { language: () => language.value });
    deepStrictEqual(spansOf(view.childNodes[0] as FakeElement), []);
    language.value = 'ts';
    flush();
    deepStrictEqual(spansOf(view.childNodes[0] as FakeElement), [
      ['tk-keyword', 'const'],
      ['tk-number', '1'],
    ]);
  });

  it('renders plain past the highlight limit', () => {
    const atLimit = mount(ref('1'.repeat(HIGHLIGHT_LIMIT)), { language: 'ts' });
    strictEqual(spansOf(atLimit.view.childNodes[0] as FakeElement).length, 1);
    const past = mount(ref('1'.repeat(HIGHLIGHT_LIMIT + 1)), { language: 'ts' });
    deepStrictEqual(spansOf(past.view.childNodes[0] as FakeElement), []);
  });

  it('sizes the gutter by the line count and drops it without line numbers', () => {
    const source = ref('a');
    const { root } = mount(source);
    ok(root.getAttribute('style')?.includes('--ohne-code-digits: 1'));
    source.value = 'a\n'.repeat(9) + 'a';
    flush();
    ok(root.getAttribute('style')?.includes('--ohne-code-digits: 2'));
    ok(!hasClass(root, 'ohne-code-plain'));
    ok(hasClass(mount(ref(''), { lineNumbers: false }).root, 'ohne-code-plain'));
  });

  it('marks the frame and the textarea for wrap and disabled', () => {
    const plain = mount(ref(''));
    strictEqual(plain.area.getAttribute('wrap'), 'off');
    ok(!hasClass(plain.root, 'ohne-code-wrap'));
    const wrapped = mount(ref(''), { wrap: true, disabled: () => true });
    strictEqual(wrapped.area.getAttribute('wrap'), null);
    ok(hasClass(wrapped.root, 'ohne-code-wrap'));
    ok(hasClass(wrapped.root, 'ohne-code-disabled'));
    strictEqual(wrapped.area.getAttribute('disabled'), '');
    const twin = findElement(wrapped.root, (element) => element.tagName === 'PRE');
    strictEqual(twin?.getAttribute('aria-hidden'), 'true');
  });
});
