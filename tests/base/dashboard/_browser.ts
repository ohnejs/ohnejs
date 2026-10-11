import { FakeElement } from '../../dashboard/_fake-dom.ts';
import { fakeBrowser, type FakeBrowser } from '../../dashboard/router/_browser.ts';

/**
 * The router's fake browser at `path`, plus the globals the base layer's modules read when they load.
 */
export function baseBrowser(path: string): FakeBrowser {
  Object.assign(FakeElement.prototype, {
    append(this: FakeElement, ...nodes: FakeElement[]) {
      for (const node of nodes) this.appendChild(node);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    contains: () => false,
    focus() {},
    getBoundingClientRect: () => ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }),
  });
  const browser = fakeBrowser(path);
  const listen = window.addEventListener.bind(window);
  const matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  Object.assign(window, {
    matchMedia,
    setTimeout,
    clearTimeout,
    addEventListener: (type: string, listener: () => void) => {
      if (type === 'popstate') listen(type, listener);
    },
    removeEventListener() {},
    navigator,
  });
  Object.assign(document, {
    documentElement: new FakeElement('html'),
    body: new FakeElement('body'),
    removeEventListener() {},
  });
  Object.assign(globalThis, {
    matchMedia,
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    requestAnimationFrame: (run: () => void) => setTimeout(run),
    cancelAnimationFrame: clearTimeout,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
  });
  return browser;
}
