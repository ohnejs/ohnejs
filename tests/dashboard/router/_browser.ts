import { flush } from '../../../src/utils/reactive/_scheduler.ts';
import '../_fake-dom.ts';

/**
 * The browser surface a router test drives: history writes it saw and a way to press back or forward.
 */
export interface FakeBrowser {
  pushes: string[];
  replaces: string[];
  popstate: (path: string) => void;
}

/**
 * Installs a location at `path`, a recording history, and the window and document hooks the router needs.
 */
export function fakeBrowser(path: string): FakeBrowser {
  const location = {
    pathname: '/',
    search: '',
    hash: '',
    get href() {
      return `http://dashboard${this.pathname}${this.search}${this.hash}`;
    },
  };
  const visit = (to: string) => {
    const url = new URL(to, location.href);
    Object.assign(location, { pathname: url.pathname, search: url.search, hash: url.hash });
  };
  const listeners: (() => void)[] = [];
  const browser: FakeBrowser = {
    pushes: [],
    replaces: [],
    popstate: (to) => {
      visit(to);
      for (const listener of listeners) listener();
    },
  };
  visit(path);
  Object.assign(document, {
    title: '',
    addEventListener: () => {},
    getElementById: () => ({
      textContent: JSON.stringify({
        apiURL: 'http://api',
        defaultLanguage: 'en',
        messageGroups: [],
      }),
    }),
  });
  Object.assign(globalThis, {
    location,
    window: { addEventListener: (_: string, listener: () => void) => listeners.push(listener) },
    history: {
      pushState: (_: unknown, __: string, to: string) => {
        browser.pushes.push(to);
        visit(to);
      },
      replaceState: (_: unknown, __: string, to: string) => {
        browser.replaces.push(to);
        visit(to);
      },
    },
    fetch: async () => new Response('{}'),
  });
  return browser;
}

/**
 * A `data:` module whose default export is `globalThis.testPages[name]`, read when it is imported.
 */
export function pageModule(name: string): string {
  const body = `export default globalThis.testPages[${JSON.stringify(name)}];`;
  return `data:text/javascript,${encodeURIComponent(body)}`;
}

/**
 * Lets pending imports and their continuations settle, then runs every queued effect.
 */
export async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setImmediate(resolve));
    flush();
  }
}
