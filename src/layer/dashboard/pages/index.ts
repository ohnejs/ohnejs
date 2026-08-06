import { css, defineDashboardPage, h, useT } from 'ohne/dashboard';

import { shell } from '../components/shell.ts';

css`
  .home-empty {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--dim);
  }
`;

/**
 * The home page: the shell with a calm empty state until a collection is chosen.
 */
export default defineDashboardPage(() => {
  const t = useT();
  return shell(() => h('div', { class: 'home-empty' }, () => t('dashboard.selectCollection')));
});
