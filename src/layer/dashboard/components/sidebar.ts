import {
  button,
  type Child,
  css,
  type DashboardCollection,
  dashboardMeta,
  each,
  h,
  logout,
  sessionUser,
  useRoute,
  useT,
  when,
} from 'ohne/dashboard';
import { ref } from 'ohne/utils';

const COLLAPSED_KEY = 'ohne:sidebar';

const collapsed = ref(localStorage.getItem(COLLAPSED_KEY) === '1');

css`
  .sidebar {
    display: flex;
    flex-direction: column;
    width: 220px;
    box-sizing: border-box;
    background: color-mix(in srgb, var(--ink) 2%, var(--paper));
    border-right: 1px solid var(--hairline);
    transition: width var(--pace);
  }

  .sidebar.collapsed {
    width: 44px;
  }

  .sidebar-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 16px 18px;
  }

  .sidebar.collapsed .sidebar-top {
    padding: 20px 0 16px;
    justify-content: center;
  }

  .sidebar-word {
    font-size: 15px;
    font-weight: 700;
    letter-spacing: -0.02em;
  }

  .sidebar-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0 16px;
  }

  .sidebar-scroll > .ohne-caps {
    margin-bottom: 10px;
  }

  .sidebar-group {
    margin-bottom: 20px;
  }

  .sidebar-group .ohne-caps {
    display: block;
    margin-bottom: 6px;
  }

  .sidebar-link {
    display: block;
    margin: 0 -16px;
    padding: 4px 16px 4px 14px;
    border-left: 2px solid transparent;
    color: var(--dim);
    transition:
      color var(--pace),
      background var(--pace);
  }

  .sidebar-link:hover {
    color: var(--ink);
    background: color-mix(in srgb, var(--ink) 4%, transparent);
  }

  .sidebar-link.active {
    color: var(--ink);
    font-weight: 500;
    border-left-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 5%, transparent);
  }

  .sidebar-foot {
    border-top: 1px solid var(--hairline);
    padding: 12px 16px;
  }

  .sidebar-user {
    display: block;
    color: var(--dim);
    font-size: 11px;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
`;

/**
 * The collapsible Ledger sidebar: wordmark, menu groups from the discovery read, session foot.
 * The collapse preference persists per browser.
 */
export function sidebar(): Child {
  const t = useT();
  return h(
    'aside',
    { class: () => `sidebar${collapsed.value ? ' collapsed' : ''}` },
    h(
      'div',
      { class: 'sidebar-top' },
      when(
        () => !collapsed.value,
        () => h('a', { class: 'sidebar-word', href: '/' }, 'ohne'),
      ),
      button(() => (collapsed.value ? '›' : '‹'), {
        kind: 'ghost',
        onClick: toggle,
      }),
    ),
    when(
      () => !collapsed.value,
      () => [
        h(
          'nav',
          { class: 'sidebar-scroll' },
          h('span', { class: 'ohne-caps' }, () => t('dashboard.collections')),
          each(
            () => dashboardMeta()?.menu ?? [],
            (group, index) => index,
            (group) =>
              h(
                'div',
                { class: 'sidebar-group' },
                when(
                  () => group().label !== '',
                  () => h('span', { class: 'ohne-caps' }, () => group().label),
                ),
                each(
                  () => group().collections,
                  (name) => name,
                  (name) => collectionLink(name),
                ),
              ),
          ),
        ),
        h(
          'div',
          { class: 'sidebar-foot' },
          h('span', { class: 'sidebar-user' }, () => sessionUser()?.email),
          button(() => t('dashboard.signOut'), { kind: 'ghost', onClick: signOut }),
        ),
      ],
    ),
  );
}

/**
 * One collection link, labeled from the discovery read and highlighted on its route.
 */
function collectionLink(name: () => string): Child {
  const entry = (): DashboardCollection | undefined =>
    dashboardMeta()?.collections.find((candidate) => candidate.name === name());
  const href = (): string => `/collections/${entry()?.segment ?? ''}`;
  return h(
    'a',
    {
      class: () => `sidebar-link${useRoute()?.path === href() ? ' active' : ''}`,
      href: () => href(),
    },
    () => entry()?.label,
  );
}

/**
 * Flips the collapse state and persists it.
 */
function toggle(): void {
  collapsed.value = !collapsed.value;
  localStorage.setItem(COLLAPSED_KEY, collapsed.value ? '1' : '0');
}

/**
 * Ends the session; the shell's guard then redirects to the login page in one navigation.
 */
function signOut(): void {
  void logout();
}
