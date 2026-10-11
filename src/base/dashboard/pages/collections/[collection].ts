import {
  type Child,
  css,
  type DashboardCollection,
  dashboardMeta,
  defineDashboardPage,
  h,
  useDocumentTitle,
  useFrame,
  useT,
  when,
} from 'ohnejs/dashboard';
import { isUndefined } from 'ohnejs/utils';

import { collectionTable } from '../../components/collection-table.ts';
import { recordEditor } from '../../components/record-editor.ts';
import { recordViewOf } from '../../components/record-view.ts';

css`
  .pane-missing {
    height: 100%;
    display: grid;
    place-items: center;
    color: hsl(var(--ohne-muted-foreground));
  }
`;

/**
 * One collection's pane: its records table over the collections API.
 * A singleton's pane is its record editor.
 * An unknown segment renders a dim not-found line once the discovery read has answered.
 */
export default defineDashboardPage((route) => {
  useFrame({ fill: true });
  return pane(() => route.params.collection ?? '');
});

/**
 * Renders the collection's table, or a singleton's editor, once the discovery read answers.
 * An unknown segment renders the not-found line.
 */
function pane(segment: () => string): Child {
  const t = useT();
  const entry = (): DashboardCollection | undefined =>
    dashboardMeta()?.collections.find((candidate) => candidate.segment === segment());
  useDocumentTitle(() => entry()?.label);
  return when(
    () => !isUndefined(dashboardMeta()),
    () =>
      when(
        () => !isUndefined(entry()),
        () => {
          const collection = entry();
          if (isUndefined(collection)) return null;
          return collection.singleton
            ? (recordViewOf(collection) ?? recordEditor)(collection, undefined)
            : collectionTable(collection);
        },
        () => h('div', { class: 'pane-missing' }, () => t('dashboard.notFound')),
      ),
  );
}
