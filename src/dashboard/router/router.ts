import type { RouteParams } from '../../utils/route/compile-route.ts';
import type { PageRoute } from '../../utils/route/page-route.ts';
import type { Child } from '../render/insert.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { ref } from '../../utils/reactive/ref.ts';
import { h } from '../render/h.ts';
import { mount } from '../render/mount.ts';
import { setDocumentTitle } from '../runtime/title.ts';
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

/**
 * Decides whether a navigation to `target` may go on: `true` lets it pass, `false` aborts it.
 * A promise holds it until it settles, as a dialog asking whether to leave does.
 */
export type NavigationGuard = (target: string) => boolean | Promise<boolean>;

let pages: CompiledPage[] = [];
const active = ref<Active | null>(null);
let token = 0;
let guard: NavigationGuard | null = null;
let rendered = '';
let at = 0;
let settling: 'undo' | 'undo-replay' | 'replay' | null = null;
let held = 0;
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
  window.addEventListener('popstate', traverse);
  document.addEventListener('click', interceptLink);
  await render();
  mount(() => view(), container);
}

/**
 * Navigates to `path` through the History API and re-renders; a no-op when already there.
 * A navigation guard set through `setNavigationGuard` may hold or abort it.
 * `replace` swaps the current history entry instead of pushing one.
 * Resolves whether the location got there, once any guard settled.
 * Without a guard holding it, history moves before this returns.
 */
export function navigate(path: string, options?: { replace?: boolean }): Promise<boolean> {
  if (path === here()) return Promise.resolve(true);
  const verdict = isNull(guard) ? true : guard(path);
  if (verdict === false) return Promise.resolve(false);
  if (verdict === true) {
    go(path, options);
    return Promise.resolve(true);
  }
  return verdict.then((leave) => leave && arrive(path, options));
}

/**
 * Handles the back and forward buttons: a step the guard holds or blocks is undone, then replayed on leave.
 * Undoing and replaying move within history, so a held step never adds an entry or drops the forward ones.
 * A step that keeps its entry index, or runs without the Navigation API, pushes the rendered path back.
 */
function traverse(): void {
  const step = settling;
  settling = null;
  if (step === 'undo') return;
  if (step === 'undo-replay') {
    replay();
    return;
  }
  const target = here();
  const verdict = step === 'replay' || isNull(guard) ? true : guard(target);
  if (verdict === true) {
    cause = 'popstate';
    void render();
    return;
  }
  const to = entryIndex();
  if (isUndefined(to) || to === at) {
    history.pushState(null, '', rendered);
    if (verdict !== false) void verdict.then((leave) => leave && arrive(target));
    return;
  }
  held = verdict === false ? 0 : to - at;
  settling = 'undo';
  history.go(at - to);
  if (verdict !== false) void verdict.then((leave) => leave && replay());
}

/**
 * Replays the held step once, however many prompts resolved with it, after its undo has landed.
 */
function replay(): void {
  if (held === 0) return;
  if (settling === 'undo') {
    settling = 'undo-replay';
    return;
  }
  const delta = held;
  held = 0;
  settling = 'replay';
  history.go(delta);
}

/**
 * The session-history index of the current entry, or `undefined` without the Navigation API.
 */
function entryIndex(): number | undefined {
  return typeof navigation === 'undefined' ? undefined : navigation.currentEntry?.index;
}

/**
 * Moves history to `path` past any guard unless it is already there, and returns `true`.
 * Several navigations a guard held all resume on one answer, so only the first one moves.
 */
function arrive(path: string, options?: { replace?: boolean }): true {
  return path === here() || go(path, options);
}

/**
 * Moves history to `path` past any guard, re-renders, and returns `true`.
 */
function go(path: string, options?: { replace?: boolean }): true {
  if (options?.replace === true) history.replaceState(null, '', path);
  else history.pushState(null, '', path);
  cause = 'navigate';
  void render();
  return true;
}

/**
 * The current location as a dashboard path.
 */
function here(): string {
  return location.pathname + location.search + location.hash;
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
 * A guard answering a promise holds the navigation, and the router resumes it past the guard on `true`.
 * The back and forward buttons are guarded too: a held or blocked step is undone, and replayed on leave.
 */
export function setNavigationGuard(next: NavigationGuard | null): void {
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
 * The title resets to the bare `ohne` first, so a page that sets none never shows the previous page's.
 */
function view(): Child {
  setDocumentTitle();
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
  rendered = here();
  at = entryIndex() ?? 0;
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
