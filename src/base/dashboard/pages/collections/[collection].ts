import {
  type Child,
  type DashboardCollection,
  dashboardMeta,
  defineDashboardPage,
  translateMessage,
  useDocumentTitle,
  useFrame,
  when,
} from 'ohnejs/dashboard';
import { isUndefined } from 'ohnejs/utils';

import { collectionTable } from '../../components/collection-table.ts';
import { notFoundState } from '../../components/not-found-state.ts';
import { recordEditor } from '../../components/record-editor.ts';
import { recordViewOf } from '../../components/record-view.ts';

/**
 * One collection's pane: its records table over the collections API.
 * A singleton's pane is its record editor.
 * An unknown segment renders a not-found state once the discovery read has answered.
 */
export default defineDashboardPage((route) => {
  useFrame({ fill: true });
  return pane(() => route.params.collection ?? '');
});

/**
 * Renders the collection's table, or a singleton's editor, once the discovery read answers.
 * An unknown segment renders the not-found state.
 */
function pane(segment: () => string): Child {
  const entry = (): DashboardCollection | undefined =>
    dashboardMeta()?.collections.find((candidate) => candidate.segment === segment());
  useDocumentTitle(() => translateMessage(entry()?.label));
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
        notFoundState,
      ),
  );
}
