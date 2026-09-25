import type { DashboardCollection, DashboardOperation } from './meta-types.ts';

/**
 * What the signed-in user may do to the rows a surface asked about.
 * A set names only asked `UUID`s, so a row missing from it is refused.
 */
export interface RowVerdicts {
  /**
   * The asked `UUID`s an update may touch.
   */
  update: ReadonlySet<string>;

  /**
   * The asked `UUID`s a whole-record delete may touch.
   */
  delete: ReadonlySet<string>;

  /**
   * The asked `UUID`s whose translation at the asked locale a delete may remove.
   * Empty on a collection that is not translatable.
   */
  deleteTranslation: ReadonlySet<string>;

  /**
   * The fields an update may write; `undefined` sets no limit.
   */
  select: readonly string[] | undefined;
}

/**
 * How many of the rows a query describes each write may touch.
 */
export interface VerdictCounts {
  /**
   * The described rows an update may touch.
   */
  update: number;

  /**
   * The described rows a whole-record delete may touch.
   */
  delete: number;
}

/**
 * The row form's answer from `POST /collections/[collection]/verdicts`.
 */
export interface RowVerdictsAnswer {
  /**
   * The asked rows the update scope admits, and the fields it lets an update write.
   */
  update: { UUIDs: string[]; select?: string[] };

  /**
   * The asked rows the delete scope admits at the default locale.
   */
  delete: { UUIDs: string[] };

  /**
   * The asked rows the delete scope admits at the asked locale; translatable collections only.
   */
  deleteTranslation?: { UUIDs: string[] };
}

/**
 * The query form's answer from `POST /collections/[collection]/verdicts`.
 */
export interface VerdictTotalsAnswer {
  /**
   * How many described rows the update scope admits, and the fields it lets an update write.
   */
  update: { total: number; select?: string[] };

  /**
   * How many described rows the delete scope admits at the default locale.
   */
  delete: { total: number };

  /**
   * How many described rows the delete scope admits at the asked locale; translatable collections only.
   */
  deleteTranslation?: { total: number };
}

/**
 * Whether the server can answer other verdicts than the capabilities alone give.
 * Only an allowed operation that is `scoped` narrows per row; a refused one admits no row either way.
 */
export function asksVerdicts(collection: DashboardCollection): boolean {
  const { update, delete: remove } = collection.operations;
  return narrows(update) || narrows(remove);
}

/**
 * The verdicts the capabilities alone give: each allowed operation admits every asked `UUID`.
 */
export function capabilityVerdicts(
  collection: DashboardCollection,
  UUIDs: readonly string[],
): RowVerdicts {
  const { update, delete: remove } = collection.operations;
  const all: ReadonlySet<string> = new Set(UUIDs);
  const none: ReadonlySet<string> = new Set();
  const removable = remove?.allowed === true ? all : none;
  return {
    update: update?.allowed === true ? all : none,
    delete: removable,
    deleteTranslation: collection.translatable ? removable : none,
    select: undefined,
  };
}

/**
 * Folds the row form's wire answer into `RowVerdicts`.
 * An operation `collection` does not allow admits no row, since its route may be dropped.
 */
export function foldVerdicts(
  answer: RowVerdictsAnswer,
  collection: DashboardCollection,
): RowVerdicts {
  const { update, delete: remove } = collection.operations;
  const updates = update?.allowed === true;
  const deletes = remove?.allowed === true;
  return {
    update: new Set(updates ? answer.update.UUIDs : []),
    delete: new Set(deletes ? answer.delete.UUIDs : []),
    deleteTranslation: new Set(deletes ? answer.deleteTranslation?.UUIDs : []),
    select: updates ? answer.update.select : undefined,
  };
}

/**
 * Folds the query form's wire answer into `VerdictCounts`.
 * An operation `collection` does not allow counts no row, as in `foldVerdicts`.
 */
export function foldCounts(
  answer: VerdictTotalsAnswer,
  collection: DashboardCollection,
): VerdictCounts {
  const { update, delete: remove } = collection.operations;
  return {
    update: update?.allowed === true ? answer.update.total : 0,
    delete: remove?.allowed === true ? answer.delete.total : 0,
  };
}

/**
 * Whether the operation's verdict can differ per row for this user.
 */
function narrows(operation: DashboardOperation | null): boolean {
  return operation?.allowed === true && operation.scoped;
}
