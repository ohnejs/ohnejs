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
    width: 232px;
    box-sizing: border-box;
    border-right: 1px solid var(--hairline);
    transition: width var(--pace);
  }

  .sidebar.collapsed {
    width: 44px;
  }

  .sidebar-top {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    padding: 20px 16px 16px;
  }

  .sidebar.collapsed .sidebar-top {
    padding: 20px 0 16px;
    justify-content: center;
  }

  .sidebar-word {
    font-size: 17px;
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
    padding: 3px 0;
    color: var(--dim);
    transition: color var(--pace);
  }

  .sidebar-link:hover {
    color: var(--ink);
  }

  .sidebar-link.active {
    color: var(--ink);
    font-weight: 500;
  }

  .sidebar-foot {
    border-top: 1px solid var(--hairline);
    padding: 12px 16px;
  }

  .sidebar-user {
    display: block;
    color: var(--dim);
    font-size: 12px;
    margin-bottom: 4px;
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
