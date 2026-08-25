import {
  base,
  type Child,
  container,
  css,
  FOCUSABLE,
  h,
  isEditingText,
  navigate,
  sessionUser,
  setNavigationGuard,
  when,
} from 'ohne/dashboard';
import {
  effect,
  isNull,
  isNullish,
  isUndefined,
  nextTick,
  onCleanup,
  ref,
  untracked,
} from 'ohne/utils';

// The layer's field types must register on every signed-in page, not only where the sheet loads:
// a record page opened directly would otherwise fall back to the primitive controls.
import './cells.ts';
import { header } from './header.ts';
import { loginPopup } from './login-popup.ts';
import { sidebar } from './sidebar.ts';
import { unsavedChangesGuard } from './unsaved-changes.ts';
import { wrapper } from './wrapper.ts';

/**
 * Options for `shell`.
 */
export interface ShellOptions {
  /**
   * Removes the main area's `0.5rem` padding.
   *
   * @default
   * false
   */
  noMainPadding?: boolean;

  /**
   * Keeps the main area from scrolling, so the content manages its own scroll at full height.
   *
   * @default
   * false
   */
  noMainScroll?: boolean;
}

interface LayoutState {
  sidebarExpanded: boolean;
  sidebarScrollY: number;
}

const layoutState = ref<LayoutState>({ sidebarExpanded: false, sidebarScrollY: 0 });

/**
 * Forgets the persisted sidebar state, as the source's logout page resets its layout state.
 */
export function resetLayoutState(): void {
  layoutState.value = { sidebarExpanded: false, sidebarScrollY: 0 };
}

const EDGE_ZONE_PX = 24;

css`
  .o-layout {
    position: relative;
    display: grid;
    grid-template-rows: 2.5rem 1fr;
    row-gap: calc(1rem + 1px);
    column-gap: 1rem;
    width: 100%;
    max-width: 108rem;
    height: 100dvh;
    margin: 0 -1rem;
    padding: 0.5rem 1.5rem 1.5rem;
    outline: none;
  }

  .o-layout-sm {
    grid-template-areas:
      'header header'
      'sidebar main';
    grid-template-columns: 16rem 1fr;
  }

  .o-layout::after {
    content: '';
    position: absolute;
    bottom: calc(1rem - 1px);
    right: -50vw;
    left: -50vw;
    height: 1px;
    background-color: hsl(var(--ohne-border));
  }

  .o-header {
    grid-area: header;
    position: relative;
  }

  .o-header::after {
    content: '';
    position: absolute;
    right: -50vw;
    bottom: calc(-0.5rem - 1px);
    left: -50vw;
    height: 1px;
    background-color: hsl(var(--ohne-border));
  }

  .o-sidebar {
    grid-area: sidebar;
    position: relative;
    display: flex;
    flex-direction: column;
    margin: -0.5rem;
    border-right: 1px solid hsl(var(--ohne-border));
  }

  .o-sidebar-content {
    width: 100%;
    padding: 0.5rem;
  }

  .o-main {
    grid-area: main;
    position: relative;
    margin: -0.5rem;
    padding: 0.5rem;
  }

  .o-main-no-padding {
    padding: 0;
  }

  .o-main-no-scroll > .ohne-container-content {
    height: 100%;
  }

  .o-main-content {
    height: 100%;
  }

  .o-default-layout .ohne-base-content {
    height: 100dvh;
    overflow: clip;
  }

  .o-default-layout .o-wrapper::before,
  .o-default-layout .o-wrapper::after {
    height: 150dvh;
    margin-top: -25dvh;
  }

  @media (max-width: 1024px) {
    .o-layout {
      grid-template-rows: 2.25rem 1fr;
    }

    .o-layout-sm {
      grid-template-areas:
        'header'
        'main';
      grid-template-columns: 1fr;
    }

    .o-sidebar {
      position: fixed;
      z-index: 99;
      top: calc(3.25rem + 1px);
      left: 0;
      bottom: 1rem;
      width: 17rem;
      max-width: 100%;
      margin: 0;
      background-color: hsl(var(--ohne-background));
      visibility: hidden;
      transform: translateX(-100%);
    }

    .o-layout-transition .o-sidebar {
      transition: var(--ohne-transition);
      transition-property: visibility transform;
      transition-duration: var(--ohne-overlay-transition-duration);
    }

    .o-sidebar-expanded .o-sidebar {
      visibility: visible;
      transform: translateX(0);
    }

    .o-main {
      transform-origin: right;
      transform: translate3d(0, 0, 0);
    }

    .o-layout-transition .o-main {
      transition: var(--ohne-transition);
      transition-property: opacity filter transform;
      transition-duration: var(--ohne-overlay-transition-duration);
    }

    .o-sidebar-expanded .o-main {
      opacity: 0.36;
      filter: blur(1px);
      transform: translate3d(0, 0, 0) scale(0.97);
    }

    .o-sidebar-expanded .o-main-content {
      pointer-events: none;
    }
  }

  @media (max-width: 767px) {
    .o-layout {
      margin: 0;
      padding: 0.5rem;
    }

    .o-layout::after {
      display: none;
    }

    .o-header::after {
      right: -0.5rem;
      left: -0.5rem;
    }

    .o-sidebar {
      bottom: 0;
    }

    .o-default-layout .o-wrapper::before,
    .o-default-layout .o-wrapper::after {
      display: none;
    }
  }
`;

/**
 * The signed-in frame, ported from Pruvious v4's default layout.
 * It holds the header row, the sidebar menu column, and the scrollable main area between the rails.
 * While the session resolves it renders nothing, so the paper stays calm.
 * A signed-out session redirects to the login page, carrying the current path as `next`.
 * Under `1024px` the sidebar becomes an overlay.
 * The hamburger, a left-edge swipe, Escape, and a click on the receded main area all toggle it.
 * Tab cycles inside header and sidebar while it is open.
 * The sidebar's scroll position and expanded state persist across navigations.
 */
export function shell(content: () => Child, options: ShellOptions = {}): Child {
  effect(() => {
    if (isNull(sessionUser())) {
      // A dirty record editor's guard must not swallow this redirect: the session is gone, and a
      // blocked navigation here would strand a blank page.
      setNavigationGuard(null);
      navigate(`/login?next=${encodeURIComponent(location.pathname)}`);
    }
  });
  const root = base([
    wrapper(
      when(
        () => !isNullish(sessionUser()),
        () => layout(content, options),
      ),
    ),
    unsavedChangesGuard(),
    loginPopup(),
  ]);
  root.classList.add('o-default-layout');
  return root;
}

/**
 * The layout grid proper: header, sidebar container, main container, and the overlay-sidebar behavior.
 */
function layout(content: () => Child, options: ShellOptions): HTMLElement {
  const transition = ref(false);
  const expanded = (): boolean => layoutState.value.sidebarExpanded;

  let transitionTimeout: number | undefined;

  const toggleSidebar = (): void => {
    clearTimeout(transitionTimeout);
    transition.value = true;
    void nextTick().then(() => {
      const state = untracked(() => layoutState.value);
      layoutState.value = { ...state, sidebarExpanded: !state.sidebarExpanded };
      transitionTimeout = window.setTimeout(() => {
        transition.value = false;
      }, overlayTransitionDuration());
    });
  };

  const headerEl = h(
    'div',
    { class: 'o-header' },
    header({ sidebarExpanded: expanded, onToggleSidebar: toggleSidebar }),
  );

  const sidebarEl = container(h('div', { class: 'o-sidebar-content' }, sidebar()));
  sidebarEl.classList.add('o-sidebar');

  const mainEl = container(h('div', { class: 'o-main-content' }, content));
  mainEl.classList.add('o-main');
  if (options.noMainPadding === true) mainEl.classList.add('o-main-no-padding');
  if (options.noMainScroll === true) mainEl.classList.add('o-main-no-scroll');
  mainEl.addEventListener('click', () => {
    if (untracked(expanded)) toggleSidebar();
  });

  // The source's focus trap, by hand: while the overlay sidebar is open, Tab cycles through
  // header and sidebar only; clicks stay allowed and focus is neither seeded nor returned.
  let releaseTrap: (() => void) | undefined;
  const activateTrap = (): void => {
    if (releaseTrap) return;
    const onTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return;
      const order = [
        ...headerEl.querySelectorAll<HTMLElement>(FOCUSABLE),
        ...sidebarEl.querySelectorAll<HTMLElement>(FOCUSABLE),
      ];
      const first = order[0];
      const final = order[order.length - 1];
      if (isUndefined(first) || isUndefined(final)) {
        event.preventDefault();
        return;
      }
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || !order.includes(active)) {
        event.preventDefault();
        (event.shiftKey ? final : first).focus();
      } else if (event.shiftKey && active === first) {
        event.preventDefault();
        final.focus();
      } else if (!event.shiftKey && active === final) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onTab, { capture: true });
    releaseTrap = () => {
      document.removeEventListener('keydown', onTab, { capture: true });
      releaseTrap = undefined;
    };
  };
  effect(() => {
    if (expanded()) untracked(activateTrap);
    else releaseTrap?.();
  });

  const overlayViewport = window.matchMedia('(max-width: 1024px)');
  let swipeStartX = 0;
  let swipeStartY = 0;
  const onTouchStart = (event: TouchEvent): void => {
    swipeStartX = event.touches[0]?.clientX ?? 0;
    swipeStartY = event.touches[0]?.clientY ?? 0;
  };
  const onTouchEnd = (event: TouchEvent): void => {
    if (!overlayViewport.matches || untracked(() => transition.value)) return;
    const touch = event.changedTouches[0];
    if (isUndefined(touch)) return;
    const deltaX = touch.clientX - swipeStartX;
    const deltaY = touch.clientY - swipeStartY;
    if (Math.abs(deltaX) < 50 || Math.abs(deltaX) <= Math.abs(deltaY)) return;
    if (!untracked(expanded) && deltaX > 0 && swipeStartX <= EDGE_ZONE_PX) toggleSidebar();
    else if (untracked(expanded) && deltaX < 0) toggleSidebar();
  };
  document.body.addEventListener('touchstart', onTouchStart, { passive: true });
  document.body.addEventListener('touchend', onTouchEnd, { passive: true });

  queueMicrotask(() => {
    sidebarEl.scrollTop = layoutState.value.sidebarScrollY;
    queueMicrotask(() => {
      // A persisted expanded overlay closes itself, animated, after navigating via a menu item.
      if (layoutState.value.sidebarExpanded) toggleSidebar();
    });
  });

  onCleanup(() => {
    layoutState.value = { ...layoutState.value, sidebarScrollY: sidebarEl.scrollTop };
    clearTimeout(transitionTimeout);
    releaseTrap?.();
    document.body.removeEventListener('touchstart', onTouchStart);
    document.body.removeEventListener('touchend', onTouchEnd);
  });

  return h(
    'div',
    {
      tabindex: '-1',
      class: () =>
        'o-layout o-layout-sm' +
        (expanded() ? ' o-sidebar-expanded' : '') +
        (transition.value ? ' o-layout-transition' : ''),
      onKeydown: (event: KeyboardEvent) => {
        if (event.key === 'Escape' && untracked(expanded) && !isEditingText()) toggleSidebar();
      },
    },
    headerEl,
    sidebarEl,
    mainEl,
  );
}

/**
 * Reads the overlay transition duration off the body, in milliseconds; `300` when unreadable.
 */
function overlayTransitionDuration(): number {
  const raw = getComputedStyle(document.body)
    .getPropertyValue('--ohne-overlay-transition-duration')
    .trim();
  if (raw.endsWith('ms')) return parseInt(raw, 10) || 300;
  if (raw.endsWith('s')) return parseFloat(raw) * 1000 || 300;
  return 300;
}
