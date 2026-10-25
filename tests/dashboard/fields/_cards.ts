import { flush, nextTick } from '../../../src/utils/reactive/_scheduler.ts';
import { FakeElement, FakeNode, findElement, hasClass } from '../_fake-dom.ts';
import { fire } from '../ui/_events.ts';

/**
 * Clicks the collapse toggle of the `index`-th card under `root`, named for what it does next.
 */
export function toggleCard(root: unknown, index: number): void {
  const names = ['dashboard.menu.collapse', 'dashboard.menu.expand'];
  let seen = 0;
  const button = findElement(
    root as FakeElement,
    (element) =>
      element.tagName === 'BUTTON' &&
      names.includes(element.getAttribute('aria-label') ?? '') &&
      seen++ === index,
  ) as FakeElement;
  fire(button, 'click');
  flush();
}

/**
 * The value of every rendered input under `root`, in document order: an expanded card's only.
 */
export function shownInputs(root: unknown): string[] {
  const values: string[] = [];
  findElement(root as FakeElement, (element) => {
    if (element.tagName === 'INPUT') values.push((element as unknown as HTMLInputElement).value);
    return false;
  });
  return values;
}

/**
 * Makes `focus()` set `document.activeElement`, so a test can follow where focus goes.
 * `isConnected` then answers whether a node still hangs under `document.body`, as a focus hand-off asks.
 * `contains` answers whether a node hangs under this one, as a control asks before it hands focus on.
 */
export function trackFocus(): void {
  Object.assign(FakeElement.prototype, {
    focus(this: FakeElement) {
      Object.assign(document, { activeElement: this });
    },
    contains(this: FakeNode, node: FakeNode | null): boolean {
      for (let current = node; current !== null; current = current.parentNode) {
        if (current === this) return true;
      }
      return false;
    },
  });
  Object.defineProperty(FakeNode.prototype, 'isConnected', {
    configurable: true,
    get(this: FakeNode): boolean {
      const parent = this.parentNode;
      return parent === null
        ? this === (document.body as unknown as FakeNode)
        : (parent as unknown as Node).isConnected;
    },
  });
}

/**
 * Mounts `root` under `document.body`, so its nodes read as connected and a removed one as not.
 */
export function mount(root: FakeElement): FakeElement {
  (document.body as unknown as FakeNode).appendChild(root);
  return root;
}

/**
 * Tells `element` that `target` inside it took focus, as the browser's `focusin` does, and focuses it.
 */
export function focusIn(element: FakeElement, target: FakeElement): void {
  (target as unknown as HTMLElement).focus();
  fire(element, 'focusin', { target });
}

/**
 * Lets a change settle as the browser does before it paints: the flush, the tick after it, and one more.
 * A list's hand-off after a restore waits for that second tick, behind the history host's own pass.
 */
export async function settle(): Promise<void> {
  flush();
  await nextTick();
  await nextTick();
}

/**
 * The menu row `label` under `root`, a message key while no catalog is loaded.
 */
export function menuRow(root: unknown, label: string): FakeElement {
  return findElement(
    root as FakeElement,
    (el) => el.getAttribute('role') === 'menuitem' && el.textContent === label,
  ) as FakeElement;
}

/**
 * Picks the More actions item `label`, a message key while no catalog is loaded, on the `index`-th card.
 * Waits out the menu's close and the new card's mount, as the browser does before it paints.
 */
export async function pick(root: unknown, index: number, label: string): Promise<void> {
  let seen = 0;
  const dots = findElement(
    root as FakeElement,
    (el) => el.getAttribute('aria-label') === 'dashboard.record.moreActions' && seen++ === index,
  ) as FakeElement;
  fire(dots, 'click');
  flush();
  fire(menuRow(dots.parentNode, label), 'click');
  await settle();
}

/**
 * Right-clicks inside the header of the `index`-th card under `root`, and returns the event.
 */
export function rightClickHeader(
  root: unknown,
  index: number,
): { defaultPrevented: boolean; propagationStopped: boolean } {
  let seen = 0;
  const header = findElement(
    root as FakeElement,
    (el) => hasClass(el, 'ohne-structure-item-header') && seen++ === index,
  ) as FakeElement;
  Object.assign(header, {
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 600, bottom: 40 }),
  });
  return fire(header, 'contextmenu', { target: header, clientX: 120, clientY: 20 });
}

/**
 * Picks the menu item `label` a right-click on the `index`-th card's header opens.
 * Waits for the menu to take focus first, then out its close, the new card's mount, and the focus restore.
 */
export async function rightPick(root: unknown, index: number, label: string): Promise<void> {
  rightClickHeader(root, index);
  await macrotask();
  await macrotask();
  fire(menuRow(document.body, label), 'click');
  await settle();
  await macrotask();
}

/**
 * Waits one macrotask, behind every timer already set.
 */
function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve));
}

/**
 * The button whose text is `label`, a message key while no catalog is loaded.
 */
export function buttonLabelled(root: unknown, label: string): FakeElement {
  return findElement(
    root as FakeElement,
    (el) =>
      el.tagName === 'BUTTON' &&
      findElement(el, (child) => child.textContent === label) !== undefined,
  ) as FakeElement;
}
