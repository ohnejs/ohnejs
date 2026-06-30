import type { RouteParams } from '../../utils/route/compile-route.ts';
import type { PageRoute } from '../../utils/route/page-route.ts';
import type { Child } from '../render/insert.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { h } from '../render/h.ts';
import { mount } from '../render/mount.ts';
import { compilePages, type CompiledPage, type MatchedRoute, matchPages } from './match-route.ts';

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
  if (path === location.pathname) return;
  history.pushState(null, '', path);
  void render();
}

function view(): Child {
  const route = active.value;
  return isNull(route) ? notFound() : route.component(route);
}

function notFound(): Child {
  return h('h1', null, 'Not found');
}

async function render(): Promise<void> {
  const match = matchPages(pages, location.pathname);
  if (isNull(match)) {
    active.value = null;
    return;
  }
  const mine = ++token;
  const module = (await import(match.url)) as { default: DashboardPage };
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
  if (isNull(anchor) || anchor.target !== '' || anchor.hasAttribute('download')) return;
  const url = new URL(anchor.href);
  if (url.origin !== location.origin) return;
  event.preventDefault();
  navigate(url.pathname);
}
