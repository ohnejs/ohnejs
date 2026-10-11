import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, type FakeNode, findElement } from '../_fake-dom.ts';
import { fire } from '../ui/_events.ts';

/**
 * Whether `element` matches a plain `tag.class` selector; anything richer never matches.
 */
function matches(element: FakeElement, selector: string): boolean {
  const match = /^([a-z]*)((?:\.[\w-]+)*)$/.exec(selector);
  if (match === null) return false;
  const [, tag, classes] = match as unknown as [string, string, string];
  if (tag !== '' && element.tagName !== tag.toUpperCase()) return false;
  const names = (element.getAttribute('class') ?? '').split(' ');
  return classes
    .split('.')
    .filter((name) => name !== '')
    .every((name) => names.includes(name));
}

Object.assign(FakeElement.prototype, {
  querySelector(this: FakeElement, selector: string) {
    return findElement(this, (element) => matches(element, selector)) ?? null;
  },
});

/**
 * The first `input` under `root`.
 */
export function inputOf(root: unknown): FakeElement {
  return findElement(root as FakeNode, (element) => element.tagName === 'INPUT') as FakeElement;
}

/**
 * Types `text` into `input` as a user would, then runs every queued effect.
 */
export function type(input: FakeElement, text: string): void {
  (input as unknown as { value: string }).value = text;
  fire(input, 'input');
  flush();
}
