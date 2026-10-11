import {
  type Child,
  css,
  type DashboardCollection,
  dashboardMeta,
  defineDashboardPage,
  fallbackLabel,
  h,
  knownLabel,
  navigate,
  useDocumentTitle,
  useFrame,
  useT,
  when,
} from 'ohnejs/dashboard';
import { isUndefined, recordHref } from 'ohnejs/utils';

import { activeContentLocale } from '../../../components/content-language-switcher.ts';
import { recordEditor } from '../../../components/record-editor.ts';
import { recordViewOf } from '../../../components/record-view.ts';

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
 * A singleton has no create mode, so its `new` redirects to the collection's own page.
 * A collection that declares a `recordPath` opens its records there, so this page redirects to it.
 * An unknown segment renders a dim not-found line once the discovery read has answered.
 */
export default defineDashboardPage((route) => {
  useFrame({ fill: true });
  return pane(
    () => route.params.collection ?? '',
    () => route.params.uuid ?? '',
  );
});

/**
 * Renders the editor once the discovery read answers, or the not-found line.
 */
function pane(segment: () => string, uuid: () => string): Child {
  const t = useT();
  const entry = (): DashboardCollection | undefined =>
    dashboardMeta()?.collections.find((candidate) => candidate.segment === segment());
  useDocumentTitle(() => {
    const collection = entry();
    const id = uuid();
    if (isUndefined(collection)) return undefined;
    const label =
      id === 'new'
        ? t('dashboard.new')
        : (knownLabel(collection.name, id, activeContentLocale()) ?? fallbackLabel(id));
    return `${label} - ${collection.label}`;
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
          if (collection.singleton && id === 'new') {
            navigate(`/collections/${collection.segment}`, { replace: true });
            return null;
          }
          if (!isUndefined(collection.recordPath) && id !== 'new') {
            navigate(recordHref(collection, id), { replace: true });
            return null;
          }
          const record = id === 'new' ? undefined : id;
          return (recordViewOf(collection) ?? recordEditor)(collection, record);
        },
        () => h('div', { class: 'o-record-page-missing' }, () => t('dashboard.notFound')),
      ),
  );
}
