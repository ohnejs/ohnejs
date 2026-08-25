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

import { recordEditor } from '../../../components/record-editor.ts';
import { shell } from '../../../components/shell.ts';

css`
  .o-record-page-missing {
    height: 100%;
    display: grid;
    place-items: center;
    color: hsl(var(--ohne-muted-foreground));
    font-size: 0.875rem;
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
  // The chunk mirrors the source's `#id - label` and `New - label`, with the editor's short-UUID chip.
  effect(() => {
    const collection = entry();
    const id = uuid();
    setDocumentTitle(
      isUndefined(collection)
        ? undefined
        : id === 'new'
          ? `${t('dashboard.new')} - ${collection.label}`
          : `#${id.slice(0, 8)} - ${collection.label}`,
    );
  });
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
        () => h('div', { class: 'o-record-page-missing' }, () => t('dashboard.notFound')),
      ),
  );
}
