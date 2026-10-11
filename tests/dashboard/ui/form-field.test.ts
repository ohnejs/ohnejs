import { deepStrictEqual, notStrictEqual, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { effectScope } from '../../../src/utils/reactive/effect-scope.ts';
import { ref } from '../../../src/utils/reactive/ref.ts';
import { FakeElement, type FakeNode, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from './_events.ts';

const { formField } = await import('../../../src/dashboard/ui/form-field.ts');
const { h } = await import('../../../src/dashboard/render/h.ts');
const { when } = await import('../../../src/dashboard/render/when.ts');

const focused: FakeElement[] = [];
const observers: (() => void)[] = [];

/**
 * Splits `list` on top-level commas, keeping those inside parentheses.
 */
function splitList(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === '(') depth++;
    else if (list[i] === ')') depth--;
    else if (list[i] === ',' && depth === 0) {
      parts.push(list.slice(start, i).trim());
      start = i + 1;
    }
  }
  return [...parts, list.slice(start).trim()];
}

/**
 * Whether `element` matches `selector`: tags, classes, attribute tests, `:not()`, and `:is()`.
 */
function matches(element: FakeElement, selector: string): boolean {
  return splitList(selector).some((compound) => {
    let rest = compound;
    const tag = /^[a-z]+/.exec(rest)?.[0];
    if (tag && element.tagName !== tag.toUpperCase()) return false;
    rest = rest.slice(tag?.length ?? 0);
    while (rest !== '') {
      const pseudo = /^:(not|is)\(/.exec(rest);
      if (pseudo) {
        let depth = 1;
        let end = pseudo[0].length;
        while (depth > 0) {
          if (rest[end] === '(') depth++;
          if (rest[end] === ')') depth--;
          end++;
        }
        const inner = matches(element, rest.slice(pseudo[0].length, end - 1));
        if (inner !== (pseudo[1] === 'is')) return false;
        rest = rest.slice(end);
        continue;
      }
      const name = /^\.([\w-]+)/.exec(rest);
      if (name) {
        if (!hasClass(element, name[1] as string)) return false;
        rest = rest.slice(name[0].length);
        continue;
      }
      const attribute = /^\[([\w-]+)(?:=['"]([^'"]*)['"])?\]/.exec(rest) as RegExpExecArray;
      const value = element.getAttribute(attribute[1] as string);
      if (value === null || (attribute[2] !== undefined && value !== attribute[2])) return false;
      rest = rest.slice(attribute[0].length);
    }
    return true;
  });
}

/**
 * Every element under `root`, depth first.
 */
function descendants(root: FakeNode): FakeElement[] {
  return root.childNodes.flatMap((node) => [
    ...(node instanceof FakeElement ? [node] : []),
    ...descendants(node),
  ]);
}

Object.assign(FakeElement.prototype, {
  querySelectorAll(this: FakeElement, selector: string) {
    return descendants(this).filter((element) => matches(element, selector));
  },
  closest(this: FakeElement, selector: string): FakeElement | null {
    if (matches(this, selector)) return this;
    const parent = this.parentNode;
    return parent instanceof FakeElement
      ? ((parent as unknown as HTMLElement).closest(selector) as unknown as FakeElement | null)
      : null;
  },
  contains(this: FakeElement, other: FakeNode | null) {
    let node = other;
    while (node && node !== this) node = node.parentNode;
    return node === this;
  },
  focus(this: FakeElement) {
    focused.push(this);
  },
});

Object.assign(globalThis, {
  MutationObserver: class {
    constructor(callback: () => void) {
      observers.push(callback);
    }

    observe(): void {}

    disconnect(): void {}
  },
});

const fake = (element: HTMLElement): FakeElement => element as unknown as FakeElement;
const byClass = (root: HTMLElement, name: string): FakeElement | undefined =>
  findElement(fake(root), (element) => hasClass(element, name));
const aria = (element: FakeElement | undefined): (string | null)[] =>
  ['aria-labelledby', 'aria-describedby', 'aria-invalid'].map(
    (name) => element?.getAttribute(name) ?? null,
  );

describe('formField', () => {
  it('labels the control, describes it, and marks it invalid while an error shows', () => {
    const error = ref('');
    const input = h('input', { class: 'raid-name' });
    const root = formField(h('div', null, input), {
      label: 'Raid name',
      description: 'Shown on the **roster**',
      error: () => error.value,
      required: true,
    });
    const label = byClass(root, 'ohne-label');
    const labelID = label?.getAttribute('id') ?? '';
    const messageID = labelID.replace(/-label$/, '-message');
    strictEqual(label?.textContent, 'Raid name');
    strictEqual(
      hasClass(byClass(root, 'ohne-field-label') as FakeElement, 'ohne-field-label-required'),
      true,
    );
    deepStrictEqual(aria(fake(input)), [labelID, messageID, null]);
    strictEqual(byClass(root, 'ohne-prose')?.getAttribute('id'), messageID);
    strictEqual(byClass(root, 'ohne-prose')?.textContent, 'Shown on the roster');

    error.value = 'The raid needs a name';
    flush();
    deepStrictEqual(aria(fake(input)), [labelID, messageID, 'true']);
    strictEqual(byClass(root, 'ohne-prose')?.textContent, 'The raid needs a name');
    strictEqual(
      hasClass(byClass(root, 'ohne-field-message') as FakeElement, 'ohne-field-message-has-errors'),
      true,
    );

    error.value = '';
    flush();
    deepStrictEqual(aria(fake(input)), [labelID, messageID, null]);
  });

  it('focuses the control on a label click', () => {
    const input = h('input');
    const root = formField(input, { label: 'Guild' });
    fire(byClass(root, 'ohne-label') as FakeElement, 'click');
    strictEqual(focused.at(-1), fake(input));
  });

  it('prefers a value control over buttons before it, and skips its own label row', () => {
    const remove = h('button');
    const input = h('input');
    const hidden = h('input', { hidden: true });
    const root = formField(h('div', null, hidden, remove, input), {
      label: 'Members',
      actions: h('button', { class: 'invite' }),
    });
    strictEqual(
      fake(input).getAttribute('aria-labelledby'),
      byClass(root, 'ohne-label')?.getAttribute('id'),
    );
    strictEqual(fake(remove).getAttribute('aria-labelledby'), null);
    strictEqual(byClass(root, 'invite')?.getAttribute('aria-labelledby'), null);
  });

  it('wires a disabled widget, and falls back to any focusable element', () => {
    const group = h('div', { role: 'group', tabindex: '-1' });
    formField(group, { label: 'Faction' });
    notStrictEqual(fake(group).getAttribute('aria-labelledby'), null);
    const handle = h('button', { tabindex: '-1' });
    formField(handle, { label: 'Realm' });
    notStrictEqual(fake(handle).getAttribute('aria-labelledby'), null);
  });

  it('renders a plain label and wires nothing without a focusable descendant', () => {
    const root = formField(h('p', null, 'Thrall'), {
      label: 'Warchief',
      description: 'Orgrimmar',
    });
    strictEqual(byClass(root, 'ohne-label')?.textContent, 'Warchief');
    fire(byClass(root, 'ohne-label') as FakeElement, 'click');
    strictEqual(
      descendants(fake(root)).some((element) => element.getAttribute('aria-labelledby') !== null),
      false,
    );
  });

  it('wires a control that mounts later, and unwires the one that left', () => {
    const loaded = ref(false);
    const first = h('input');
    const scope = effectScope();
    const root = scope.run(() =>
      formField(
        when(
          () => loaded.value,
          () => first,
          () => 'Summoning...',
        ),
        { label: 'Mount', error: () => 'Too heavy' },
      ),
    );
    const rewire = observers.at(-1) as () => void;
    strictEqual(fake(first).getAttribute('aria-labelledby'), null);
    loaded.value = true;
    flush();
    rewire();
    flush();
    deepStrictEqual(aria(fake(first)).slice(2), ['true']);
    strictEqual(
      fake(first).getAttribute('aria-labelledby'),
      byClass(root, 'ohne-label')?.getAttribute('id'),
    );
    loaded.value = false;
    flush();
    rewire();
    flush();
    deepStrictEqual(aria(fake(first)), [null, null, null]);
    scope.dispose();
  });

  it('leaves the attributes it does not own to the control', () => {
    const input = h('input', { 'aria-labelledby': 'row-label', 'aria-invalid': 'true' });
    formField(input);
    formField(input, { description: 'Ashenvale' });
    strictEqual(fake(input).getAttribute('aria-labelledby'), 'row-label');
    strictEqual(fake(input).getAttribute('aria-invalid'), 'true');
  });

  it('is the bare stack without options, carrying size and class', () => {
    const root = formField('Leave', { size: -1, class: 'ohne-field-narrow' });
    strictEqual(fake(root).getAttribute('class'), 'ohne-field ohne-field-narrow');
    strictEqual(fake(root).getAttribute('style'), '--ohne-size: -1');
    strictEqual(byClass(root, 'ohne-field-label'), undefined);
    strictEqual(root.textContent, 'Leave');
  });
});
