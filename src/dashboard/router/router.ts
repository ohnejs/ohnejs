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

let pages: CompiledPage[] = [];
const active = ref<Active | null>(null);
let token = 0;

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
  window.addEventListener('popstate', () => void render());
  document.addEventListener('click', interceptLink);
  await render();
  mount(() => view(), container);
}

/**
 * Navigates to `path` through the History API and re-renders; a no-op when already there.
 */
export function navigate(path: string): void {
  if (path === location.pathname + location.search + location.hash) return;
  history.pushState(null, '', path);
  void render();
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

function view(): Child {
  const route = active.value;
  return isNull(route) ? notFound() : route.component(route);
}

function notFound(): Child {
  return h('h1', null, 'Not found');
}

async function render(): Promise<void> {
  const mine = ++token;
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
