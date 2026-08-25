import {
  type Child,
  css,
  type DashboardCollection,
  dashboardMeta,
  defineDashboardPage,
  h,
  setDocumentTitle,
  useT,
  when,
} from 'ohne/dashboard';
import { effect, isUndefined } from 'ohne/utils';

import { collectionTable } from '../../components/collection-table.ts';
import { shell } from '../../components/shell.ts';

css`
  .pane-missing {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--faint);
    font-size: var(--fs-body);
  }
`;

/**
 * One collection's pane: its records table over the collections API.
 * An unknown segment renders a dim not-found line once the discovery read has answered.
 */
export default defineDashboardPage((route) =>
  shell(() => pane(() => route.params.collection ?? ''), {
    noMainPadding: true,
    noMainScroll: true,
  }),
);

/**
 * Renders the collection's table once the discovery read answers, or the not-found line.
 */
function pane(segment: () => string): Child {
  const t = useT();
  const entry = (): DashboardCollection | undefined =>
    dashboardMeta()?.collections.find((candidate) => candidate.segment === segment());
  effect(() => setDocumentTitle(entry()?.label));
  return when(
    () => !isUndefined(dashboardMeta()),
    () =>
      when(
        () => !isUndefined(entry()),
        () => {
          const collection = entry();
          return isUndefined(collection) ? null : collectionTable(collection);
        },
        () => h('div', { class: 'pane-missing' }, () => t('dashboard.notFound')),
      ),
  );
}
