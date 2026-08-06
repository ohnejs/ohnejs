import {
  type Child,
  css,
  type DashboardCollection,
  dashboardMeta,
  defineDashboardPage,
  h,
  useT,
  when,
} from 'ohne/dashboard';
import { isUndefined } from 'ohne/utils';

import { shell } from '../../components/shell.ts';

css`
  .pane-title {
    margin: 0;
    font-size: 21px;
    font-weight: 700;
    letter-spacing: -0.01em;
  }

  .pane-rule {
    border: none;
    border-top: 1px solid var(--hairline);
    margin: 14px 0 20px;
  }

  .pane-missing {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--dim);
  }
`;

/**
 * One collection's pane: the sheet's future home, today its titled frame.
 * An unknown segment renders a dim not-found line once the discovery read has answered.
 */
export default defineDashboardPage((route) =>
  shell(() => pane(() => route.params.collection ?? '')),
);

/**
 * Renders the collection's title once the discovery read answers, or the not-found line.
 */
function pane(segment: () => string): Child {
  const t = useT();
  const entry = (): DashboardCollection | undefined =>
    dashboardMeta()?.collections.find((candidate) => candidate.segment === segment());
  return when(
    () => !isUndefined(dashboardMeta()),
    () =>
      when(
        () => !isUndefined(entry()),
        () => [
          h('h1', { class: 'pane-title' }, () => entry()?.label),
          h('hr', { class: 'pane-rule' }),
        ],
        () => h('div', { class: 'pane-missing' }, () => t('dashboard.notFound')),
      ),
  );
}
