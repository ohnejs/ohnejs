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

import { recordEditor } from '../../../components/record-editor.ts';
import { shell } from '../../../components/shell.ts';

css`
  .record-pane-missing {
    height: 100%;
    display: grid;
    place-items: center;
    color: var(--faint);
    font-size: var(--fs-body);
  }
`;

/**
 * One record's page: the record editor, at `/collections/[collection]/[uuid]`.
 * The reserved uuid `new` opens the same editor in create mode, so create and edit are one surface.
 * An unknown segment renders a dim not-found line once the discovery read has answered.
 */
export default defineDashboardPage((route) =>
  shell(
    () =>
      pane(
        () => route.params.collection ?? '',
        () => route.params.uuid ?? '',
      ),
    { noMainPadding: true, noMainScroll: true },
  ),
);

/**
 * Renders the editor once the discovery read answers, or the not-found line.
 */
function pane(segment: () => string, uuid: () => string): Child {
  const t = useT();
  const entry = (): DashboardCollection | undefined =>
    dashboardMeta()?.collections.find((candidate) => candidate.segment === segment());
  return when(
    () => !isUndefined(dashboardMeta()),
    () =>
      when(
        () => !isUndefined(entry()),
        () => {
          const collection = entry();
          if (isUndefined(collection)) return null;
          const id = uuid();
          return recordEditor(collection, id === 'new' ? undefined : id);
        },
        () => h('div', { class: 'record-pane-missing' }, () => t('dashboard.notFound')),
      ),
  );
}
