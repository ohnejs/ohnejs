import type { RouteParams } from '../../utils/route/compile-route.ts';
import type { PageRoute } from '../../utils/route/page-route.ts';
import type { SearchParamValue } from '../../utils/search-params/coerce-token.ts';
import type { Child } from '../render/insert.ts';

import { isNull } from '../../utils/is/is-null.ts';
import { isUndefined } from '../../utils/is/is-undefined.ts';
import { batchedEffect } from '../../utils/reactive/batched-effect.ts';
import { computed } from '../../utils/reactive/computed.ts';
import { ref, type Ref } from '../../utils/reactive/ref.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { parseSearchParams } from '../../utils/search-params/parse-search-params.ts';
import { canonicalPath } from '../../utils/uri/canonical-path.ts';
import { css } from '../render/css.ts';
import { h } from '../render/h.ts';
import { mount } from '../render/mount.ts';
import { when } from '../render/when.ts';
import { loadLanguage } from '../runtime/messages.ts';
import { commitDashboardLanguage, requestedLanguage } from '../runtime/use-dashboard-language.ts';
import { errorState } from '../ui/states.ts';
import { defineDashboardPage } from './define-dashboard-page.ts';
import { compilePages, matchPages, type CompiledPage, type MatchedRoute } from './match-route.ts';
import { frameOptions, registeredFrame } from './page-frame.ts';

/**
 * The context a page component receives: its decoded route params, the matched path, and the query.
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

  /**
   * The location's search params, as `parseSearchParams` decodes them.
   * Reactive: a navigation that changes only the query updates it in place and keeps the page.
   */
  readonly query: { readonly [key: string]: SearchParamValue };
}

/**
 * A dashboard page component, rendered for its route with the route context.
 * `defineDashboardPage` makes one.
 */
export interface DashboardPage {
  /**
   * Builds the page for `route`.
   */
  (route: RouteContext): Child;

  /**
   * Whether the page renders inside the registered page frame.
   */
  readonly frame: boolean;
}

interface Active extends MatchedRoute, RouteContext {
  component: ((route: RouteContext) => Child) & { readonly frame?: boolean };
  search: Ref<string>;
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
const framed = ref(false);
const framedRoute = ref<Active | null>(null);
const bareRoute = ref<Active | null>(null);
let token = 0;
let published = 0;
let guard: NavigationGuard | null = null;
let rendered = '';
let at = 0;
let settling: 'undo' | 'undo-replay' | 'replay' | null = null;
let held = 0;
let cause: NavigationCause = 'load';

css`
  .ohne-load-failed {
    min-height: 100%;
    justify-content: center;
  }

  .ohne-load-failed-bare {
    min-height: 100dvh;
  }
`;

/**
 * Starts the client router: it renders the matched page for the current URL into `container`.
 *
 * Navigation re-renders in place, without a full reload.
 * A same-origin left-click on a link, a `navigate` call, or the back and forward buttons swap the page.
 * A step that changes only the query or the hash keeps the page and updates `route.query` in place.
 * The registered page frame mounts once around every framed page and stays across navigations.
 * The first page builds once its module has loaded and the dashboard language's catalogs have settled.
 * A catalog that failed to load does not hold it back; its live strings fill in once its retry succeeds.
 * A requested language becomes the rendered one with the page that arrives next.
 * With no navigation pending it switches at once, re-rendering the live strings in place.
 */
export async function startRouter(
  manifest: readonly PageRoute[],
  container: Element,
): Promise<void> {
  pages = compilePages(manifest);
  window.addEventListener('popstate', traverse);
  document.addEventListener('click', interceptLink);
  await Promise.all([render(), loadLanguage(untracked(() => requestedLanguage().value))]);
  commitDashboardLanguage();
  mount(frameRegion(), container);
  batchedEffect(() => {
    void requestedLanguage().value;
    if (published === token) untracked(commitDashboardLanguage);
  });
}

/**
 * Navigates to `path` through the History API and re-renders; a no-op when already there.
 * Unsaved changes registered through `useUnsavedChanges` may hold or abort a step that leaves the pathname.
 * `replace` swaps the current history entry instead of pushing one.
 * Resolves whether the location got there, once any guard settled.
 * Without a guard holding it, history moves before this returns.
 * A step within the pathname is never guarded, so `route.query` reads the new query on the next line.
 */
export function navigate(path: string, options?: { replace?: boolean }): Promise<boolean> {
  if (path === here()) return Promise.resolve(true);
  const verdict = isNull(guard) || pathnameOf(path) === location.pathname ? true : guard(path);
  if (verdict === false) return Promise.resolve(false);
  if (verdict === true) {
    go(path, options);
    return Promise.resolve(true);
  }
  return verdict.then((leave) => leave && arrive(path, options));
}

/**
 * Handles the back and forward buttons: a step the guard holds or blocks is undone, then replayed on leave.
 * A step within the rendered pathname is never guarded.
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
  const verdict =
    step === 'replay' || isNull(guard) || location.pathname === pathnameOf(rendered)
      ? true
      : guard(target);
  if (verdict === true) {
    cause = 'popstate';
    advance();
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
  advance();
  return true;
}

/**
 * Follows the location after history moved.
 * A step within the active page's pathname, with no render pending, keeps the page and writes the query.
 * Any other step renders the location in full.
 */
function advance(): void {
  const route = untracked(() => active.value);
  if (isNull(route) || published !== token || canonicalPath(location.pathname) !== route.path) {
    void render();
    return;
  }
  rendered = here();
  at = entryIndex() ?? 0;
  route.search.value = location.search;
}

/**
 * The current location as a dashboard path.
 */
function here(): string {
  return location.pathname + location.search + location.hash;
}

/**
 * The pathname `path` resolves to against the current location.
 */
function pathnameOf(path: string): string | undefined {
  return URL.parse(path, location.href)?.pathname;
}

/**
 * How the current location was reached, so a page can tell a fresh visit from back and forward.
 * A page that restores a remembered view on a bare URL checks this, since back must land on the bare view.
 *
 * The cause is set on every step, query-only ones included, before the page or its query updates.
 *
 * @example
 * ```ts
 * effect(() => {
 *   if (isEmpty(route.query) && remembered !== '' && lastNavigation() !== 'popstate') {
 *     navigate(route.path + remembered, { replace: true })
 *   }
 * })
 * ```
 */
export function lastNavigation(): NavigationCause {
  return cause;
}

/**
 * Installs the guard every navigation that leaves the pathname consults, or uninstalls it with `null`.
 * A guard answering a promise holds the navigation, and the router resumes it past the guard on `true`.
 * The back and forward buttons are guarded too: a held or blocked step is undone, and replayed on leave.
 * Internal to the dashboard: `useUnsavedChanges` owns the one slot.
 */
export function setNavigationGuard(next: NavigationGuard | null): void {
  guard = next;
}

/**
 * Reads the active route; `null` before the first render and on an unmatched URL.
 * The read is reactive: a binding reading it re-renders on every navigation that swaps the page.
 * A query-only step keeps the same route object and updates its `query` in place.
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
 * The registered frame around the framed page, or the bare page, whichever the active route asks for.
 * Each branch builds from its own route ref, so a page builds once per visit and only in its own branch.
 */
function frameRegion(): Child {
  return when(
    () => framed.value,
    () => registeredFrame()?.({ content: () => build(framedRoute.value), options: frameOptions }),
    () => () => build(bareRoute.value),
  );
}

/**
 * The page built for `route`, or the not-found page when no route matched.
 * A page builds untracked: it rebuilds on navigation, never on a ref it reads or a language switch.
 */
function build(route: Active | null): Child {
  return isNull(route) ? notFound() : untracked(() => route.component(route));
}

/**
 * The dashboard's own not-found page.
 */
function notFound(): Child {
  return h('h1', null, 'Not found');
}

/**
 * The page standing in for one whose module failed to load, centered in the frame or on the bare screen.
 * The browser keeps a failed module failed for the document's life, so its retry reloads the page.
 */
function loadFailed(frame: boolean): HTMLElement {
  const state = errorState(undefined, { retry: () => location.reload() });
  state.classList.add('ohne-load-failed');
  if (!frame) state.classList.add('ohne-load-failed-bare');
  return state;
}

/**
 * Matches the current location, loads its page module on demand, and publishes it as the active route.
 * A render superseded by a newer navigation publishes nothing, so a slow module never wins over a later page.
 * A module that fails to load still publishes its route, with `loadFailed` in place of the page.
 * Whether the page wants the frame is unknown then, so the failure keeps the frame on screen as it is.
 */
async function render(): Promise<void> {
  const mine = ++token;
  rendered = here();
  at = entryIndex() ?? 0;
  const match = matchPages(pages, location.pathname);
  if (isNull(match)) {
    publish(mine, null);
    return;
  }
  let component: Active['component'];
  try {
    component = ((await import(match.url)) as { default: Active['component'] }).default;
  } catch (error) {
    if (mine !== token) return;
    console.error(error);
    const frame = untracked(() => framed.value);
    component = defineDashboardPage(() => loadFailed(frame), { frame });
  }
  if (mine !== token) return;
  const search = ref(location.search);
  const query = computed(() => parseSearchParams(search.value));
  publish(mine, {
    ...match,
    component,
    search,
    get query() {
      return query.value;
    },
  });
}

/**
 * Makes `route` the active route on behalf of render `mine`, the latest one.
 * A language requested meanwhile commits first, so the arriving page builds in it.
 * Only the arriving branch's route ref changes, so the outgoing branch never rebuilds before it swaps.
 * An unmatched location renders framed.
 */
function publish(mine: number, route: Active | null): void {
  published = mine;
  commitDashboardLanguage();
  const inFrame = !isNull(registeredFrame()) && route?.component.frame !== false;
  if (inFrame) framedRoute.value = route;
  else bareRoute.value = route;
  framed.value = inFrame;
  active.value = route;
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
