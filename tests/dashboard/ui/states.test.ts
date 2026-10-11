import { deepStrictEqual, strictEqual } from 'node:assert';
import { before, describe, it } from 'node:test';

import { type FakeElement, findElement, hasClass } from '../_fake-dom.ts';

const { emptyState, errorState, skeleton, spinner } =
  await import('../../../src/dashboard/ui/states.ts');

const fake = (element: HTMLElement): FakeElement => element as unknown as FakeElement;

before(() => {
  Object.assign(document, {
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
});

describe('emptyState', () => {
  it('shows the title, the text, and the action under the icon', () => {
    const element = emptyState('No quests yet', { title: 'Quest log', action: 'Accept' });
    strictEqual(element.textContent, 'Quest logNo quests yetAccept');
    strictEqual((fake(element).childNodes[0] as FakeElement).tagName, 'SVG');
  });

  it('draws only the icon and the text without options', () => {
    strictEqual(emptyState('Nothing here').childNodes.length, 2);
  });
});

describe('errorState', () => {
  it('falls back to the default text as an alert', () => {
    const element = errorState();
    strictEqual(element.textContent, 'Failed to load');
    strictEqual(element.getAttribute('role'), 'alert');
  });

  it('adds a retry button only with `retry`', () => {
    const tag = (element: HTMLElement): string | undefined =>
      findElement(fake(element), (child) => child.tagName === 'BUTTON')?.tagName;
    strictEqual(tag(errorState('The portal collapsed')), undefined);
    strictEqual(tag(errorState('The portal collapsed', { retry: () => {} })), 'BUTTON');
  });
});

describe('skeleton', () => {
  it('stacks one bar per line, hidden from screen readers', () => {
    const element = skeleton({ lines: 3 });
    strictEqual(element.getAttribute('aria-hidden'), 'true');
    deepStrictEqual(
      fake(element).childNodes.map((child) => hasClass(child as FakeElement, 'ohne-skeleton-bar')),
      [true, true, true],
    );
  });

  it('draws one block filling `height`, sized by `width`', () => {
    const element = skeleton({ height: '100%', width: '50%' });
    strictEqual(element.getAttribute('style'), 'width: 50%; height: 100%');
    strictEqual(element.childNodes.length, 1);
    const block = fake(element).childNodes[0] as FakeElement;
    strictEqual(hasClass(block, 'ohne-skeleton-block'), true);
    strictEqual(block.getAttribute('style'), null);
  });

  it('keeps one line for a count below one', () => {
    strictEqual(skeleton({ lines: 0 }).childNodes.length, 1);
  });
});

describe('spinner', () => {
  it('announces a hidden loading label and pins the size', () => {
    const element = spinner({ size: -1 });
    strictEqual(element.getAttribute('role'), 'status');
    strictEqual(element.textContent, 'Loading');
    strictEqual(element.getAttribute('style'), '--ohne-size: -1');
  });
});
