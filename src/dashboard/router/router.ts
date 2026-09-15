import type { RouteParams } from '../../utils/route/compile-route.ts';
import type { PageRoute } from '../../utils/route/page-route.ts';
import type { Child } from '../render/insert.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { h } from '../render/h.ts';
import { mount } from '../render/mount.ts';
import { compilePages, matchPages, type CompiledPage, type MatchedRoute } from './match-route.ts';

/**
 * The context a page component receives: its decoded route params and the matched path.
 */
export interface RouteContext {
  /**
   * The matched route's params, URI-decoded.
   */
  params: RouteParams;

  /**
   * The matched location path.
   */
  path: string;
}

/**
 * A dashboard page component, rendered for its route with the route context.
 */
export type DashboardPage = (route: RouteContext) => Child;

interface Active extends MatchedRoute {
  component: DashboardPage;
}

/**
 * How the current location was reached.
 * The initial `load`, a `navigate` call or an intercepted link, or `popstate` for back and forward.
 */
export type NavigationCause = 'load' | 'navigate' | 'popstate';

let pages: CompiledPage[] = [];
const active = ref<Active | null>(null);
let token = 0;
let guard: ((target: string) => boolean) | null = null;
let rendered = '';
let cause: NavigationCause = 'load';

/**
 * Starts the client router: it renders the matched page for the current URL into `container`.
 *
 * Navigation re-renders in place, without a full reload.
 * A same-origin left-click on a link, a `navigate` call, or the back and forward buttons swap the page.
 */
export async function startRouter(
  manifest: readonly PageRoute[],
  container: Element,
): Promise<void> {
  pages = compilePages(manifest);
  window.addEventListener('popstate', () => {
    const target = location.pathname + location.search + location.hash;
    if (!isNull(guard) && !guard(target)) {
      history.pushState(null, '', rendered);
      return;
    }
    cause = 'popstate';
    void render();
  });
  document.addEventListener('click', interceptLink);
  await render();
  mount(() => view(), container);
}

/**
 * Navigates to `path` through the History API and re-renders; a no-op when already there.
 * A navigation guard set through `setNavigationGuard` may abort it.
 * `replace` swaps the current history entry instead of pushing one.
 */
export function navigate(path: string, options?: { replace?: boolean }): void {
  if (path === location.pathname + location.search + location.hash) return;
  if (!isNull(guard) && !guard(path)) return;
  if (options?.replace === true) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  cause = 'navigate';
  void render();
}

/**
 * How the current location was reached, so a page can tell a fresh visit from back and forward.
 * A page that restores a remembered view on a bare URL checks this, since back must land on the bare view.
 *
 * @example
 * ```ts
 * if (location.search === '' && remembered !== '' && lastNavigation() !== 'popstate') {
 *   navigate(location.pathname + remembered, { replace: true })
 * }
 * ```
 */
export function lastNavigation(): NavigationCause {
  return cause;
}

/**
 * Installs the guard every navigation consults before touching history, or uninstalls it with `null`.
 * A guard returning `false` aborts the navigation and owns resuming it later.
 * A resuming `navigate` call consults the guard again, so the guard must let it pass or be uninstalled.
 * The back and forward buttons are guarded too: a blocked popstate re-pushes the rendered path.
 */
export function setNavigationGuard(next: ((target: string) => boolean) | null): void {
  guard = next;
}

/**
 * Reads the active route; `null` before the first render and on an unmatched URL.
 * The read is reactive: a binding reading it re-renders on every navigation.
 * Components outside the page tree, like a sidebar, use it to follow the location.
 *
 * @example
 * ```ts
 * h('a', {
 *   href: '/posts',
 *   'aria-current': () => (useRoute()?.path === '/posts' ? 'page' : false),
 * })
 * ```
 */
export function useRoute(): RouteContext | null {
  return active.value;
}

/**
 * The active page rendered for its route, or the not-found page when no route matched.
 */
function view(): Child {
  const route = active.value;
  return isNull(route) ? notFound() : route.component(route);
}

/**
 * The dashboard's own not-found page.
 */
function notFound(): Child {
  return h('h1', null, 'Not found');
}

/**
 * Matches the current location, loads its page module on demand, and publishes it as the active route.
 * A render superseded by a newer navigation publishes nothing, so a slow module never wins over a later page.
 */
async function render(): Promise<void> {
  const mine = ++token;
  rendered = location.pathname + location.search + location.hash;
  const match = matchPages(pages, location.pathname);
  if (isNull(match)) {
    active.value = null;
    return;
  }
  let module: { default: DashboardPage };
  try {
    module = (await import(match.url)) as { default: DashboardPage };
  } catch (error) {
    if (mine !== token) return;
    console.error(error);
    active.value = null;
    return;
  }
  if (mine !== token) return;
  active.value = { ...match, component: module.default };
}

/**
 * Turns a plain left-click on a same-origin link into a client navigation.
 * Modified clicks, links with a target or a download, and hash-only changes keep the browser's behaviour.
 */
function interceptLink(event: MouseEvent): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest('a');
  if (isNull(anchor) || !anchor.hasAttribute('href')) return;
  if (anchor.target !== '' || anchor.hasAttribute('download')) return;
  const url = URL.parse(anchor.href);
  if (isNull(url) || url.origin !== location.origin) return;
  if (url.pathname === location.pathname && url.search === location.search && url.hash !== '') {
    return;
  }
  event.preventDefault();
  navigate(url.pathname + url.search + url.hash);
}
