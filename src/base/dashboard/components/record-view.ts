import type { Child, DashboardCollection } from 'ohnejs/dashboard';

import { isUndefined } from 'ohnejs/utils';

/**
 * Renders the page of one record, in place of the default record editor.
 * `uuid` absent means create, or a singleton's one record.
 */
export type RecordView = (collection: DashboardCollection, uuid: string | undefined) => Child;

const matchers: ((collection: DashboardCollection) => RecordView | undefined)[] = [];

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
