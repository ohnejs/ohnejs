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

import { collectionSheet } from '../../components/collection-sheet.ts';
import { shell } from '../../components/shell.ts';

css`
  .pane-missing {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--dim);
  }
`;

/**
 * One collection's pane: its title over the records sheet.
 * An unknown segment renders a dim not-found line once the discovery read has answered.
 */
export default defineDashboardPage((route) =>
  shell(() => pane(() => route.params.collection ?? '')),
);

/**
 * Renders the collection's title and sheet once the discovery read answers, or the not-found line.
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
        () => collectionSheet(entry),
        () => h('div', { class: 'pane-missing' }, () => t('dashboard.notFound')),
      ),
  );
}
