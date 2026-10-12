import type { Child, DashboardCollection } from 'ohnejs/dashboard';

import { css, h } from 'ohnejs/dashboard';
import { isUndefined } from 'ohnejs/utils';

import type { RecordEditor } from './record-editor.ts';

/**
 * Renders the page of one record, in place of the default record editor.
 * `uuid` absent means create, or a singleton's one record.
 */
export type RecordView = (collection: DashboardCollection, uuid: string | undefined) => Child;

const matchers: ((collection: DashboardCollection) => RecordView | undefined)[] = [];
const notices: ((editor: RecordEditor) => Child)[] = [];

css`
  .o-record-notices {
    display: grid;
    gap: 0.5rem;
  }

  .o-record-notices:has(> *) {
    margin-bottom: 0.75rem;
  }
`;

/**
 * Registers a record page for the collections `match` answers a view for.
 * A layer's dashboard boot file uses it to give some collections their own editor.
 * The latest registration that answers wins, so an app's boot file overrides its layers'.
 * A view usually builds on `useRecordEditor`, so loading, saving, undo, and the leave guard stay the same.
 */
export function registerRecordView(
  match: (collection: DashboardCollection) => RecordView | undefined,
): void {
  matchers.push(match);
}

/**
 * The view registered for `collection`, or `undefined` when the default record editor applies.
 */
export function recordViewOf(collection: DashboardCollection): RecordView | undefined {
  for (let index = matchers.length - 1; index >= 0; index--) {
    const view = matchers[index]?.(collection);
    if (!isUndefined(view)) return view;
  }
  return undefined;
}

/**
 * Registers a notice above a record's fields, for what the user should know about the record as it stands.
 * `render` runs each time the editor renders its fields, in their scope, so a reactive read stays current.
 * Answer `null` for a record the notice does not concern.
 * The default record editor shows every notice; a registered view shows them through `recordNotices`.
 *
 * @example
 * ```ts
 * registerRecordNotice((editor) => () => (editor.saved().locked ? note('Locked by an admin') : null))
 * ```
 */
export function registerRecordNotice(render: (editor: RecordEditor) => Child): void {
  notices.push(render);
}

/**
 * Every registered notice for `editor`, in registration order, spaced from the fields below when any shows.
 */
export function recordNotices(editor: RecordEditor): Child {
  return h(
    'div',
    { class: 'o-record-notices' },
    notices.map((render) => render(editor)),
  );
}
