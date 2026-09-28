import type { ConditionNode } from '../../utils/index.ts';
import type { Transaction } from '../database/adapter.ts';
import type { OrderDirection, OrderEntry, PopulateNode } from './ir.ts';
import type { CollectionQueryMeta } from './metadata.ts';
import type { QueryRecord } from './read/find.ts';
import type { PaginatedResult } from './read/paginate.ts';
import type {
  ConditionInput,
  PopulateBuild,
  PopulateSpec,
  UntypedQueryBuilder,
  UntypedWhereBranch,
  UntypedWhereGroup,
  WhereGroupBuild,
} from './untyped.ts';
import type { ReachResolver } from './wire/reach.ts';
import type { CreateOutcome } from './write/create.ts';

import { isNull, isString, isUndefined, parseCondition } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import {
  freezeConditions,
  freezeIR,
  type QueryIR,
  readCondition,
  type TargetReach,
  type WireReach,
} from './ir.ts';
import { checkQueryLocale } from './locale.ts';
import { addPopulateEntries } from './populate.ts';
import { count as countRows, exists as existsRows } from './read/count.ts';
import { findFirst as readFirst, findMany as readMany } from './read/find.ts';
import { paginate as readPage } from './read/paginate.ts';
import { pluck as pluckRows } from './read/pluck.ts';
import { unknownFieldError, validateCondition } from './validate-condition.ts';
import { lowerField } from './where-field.ts';
import { runCreate } from './write/create.ts';
import { runDelete, runDeleteTranslation, type DeleteOutcome } from './write/delete.ts';
import { validationError } from './write/errors.ts';
import { runUpdate, type UpdateOutcome } from './write/update.ts';

/**
 * The one runtime query builder every typed state and the wire path drive.
 *
 * It accumulates plain state and freezes an immutable `QueryIR` when a terminal runs.
 * `where` AND-appends, `select` and the sort keys accumulate, `limit`/`offset` replace.
 * Each accumulation is append-only: no call silently discards a prior one.
 */
export class QueryBuilderImpl implements UntypedQueryBuilder {
  private readonly conditions: ConditionNode[] = [];
  private readonly accessNodes: ConditionNode[] = [];
  private readonly orderKeys: OrderEntry[] = [];
  private readonly populateNodes: PopulateNode[] = [];
  private selected: string[] | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  private localeValue: string | null = null;
  private wireState: WireReach | null = null;
  private unscopedChain = false;
  private linkResolver: ReachResolver | null = null;
  private joinedTx?: Transaction;
  private readonly meta: CollectionQueryMeta;

  constructor(meta: CollectionQueryMeta) {
    this.meta = meta;
  }

  where(fieldOrCondition: string | ConditionInput, value?: unknown): this {
    this.conditions.push(toConditionNode(toConditionInput(fieldOrCondition, value), this.meta));
    return this;
  }

  whereAny(build: WhereGroupBuild): this {
    this.conditions.push(orGroup(build, this.meta));
    return this;
  }

  access(condition: ConditionInput): this {
    const node = toConditionNode(condition, this.meta);
    this.conditions.push(node);
    this.accessNodes.push(node);
    return this;
  }

  wire(condition: ConditionInput | null, reach: ReadonlyMap<string, TargetReach>): this {
    this.wireState = {
      condition: isNull(condition) ? null : toConditionNode(condition, this.meta),
      reach,
    };
    return this;
  }

  select(...fields: string[]): this {
    if (fields.length === 0) return this;
    for (const field of fields) {
      if (isUndefined(this.meta.fields[field])) throw unknownFieldError(field, this.meta);
    }
    this.selected = [...(this.selected ?? []), ...fields];
    return this;
  }

  populate(...entries: (string | PopulateSpec)[]): this;
  populate(field: string, build: PopulateBuild): this;
  populate(...args: (string | PopulateSpec | PopulateBuild)[]): this {
    addPopulateEntries(this.populateNodes, args, this.meta);
    return this;
  }

  orderBy(field: string, direction: OrderDirection = 'asc'): this {
    const entry = this.meta.fields[field];
    if (isUndefined(entry)) throw unknownFieldError(field, this.meta);
    if (isUndefined(entry.column)) {
      throw ohneError({
        title: `Cannot order by \`${field}\``,
        body: [
          `Field \`${field}\` on collection \`${this.meta.collection}\` has no column to sort by.`,
        ],
      });
    }
    this.orderKeys.push({ field, direction });
    return this;
  }

  limit(count: number): this {
    this.limitValue = count;
    return this;
  }

  offset(count: number): this {
    this.offsetValue = count;
    return this;
  }

  locale(code: string): this {
    if (this.meta.translatable !== true) {
      throw ohneError({
        title: `Cannot set a locale on \`${this.meta.collection}\``,
        body: [
          `Collection \`${this.meta.collection}\` has no translatable field, so a locale scopes nothing.`,
        ],
      });
    }
    if (!isNull(this.localeValue)) {
      throw ohneError({
        title: 'Locale already set',
        body: [
          `This query already reads \`${this.localeValue}\`; a chain scopes to one locale.`,
          'Open a new query for another locale.',
        ],
      });
    }
    this.localeValue = checkQueryLocale(code);
    return this;
  }

  findMany(): Promise<QueryRecord[]> {
    return readMany(this.freeze());
  }

  findFirst(): Promise<QueryRecord | undefined> {
    return readFirst(this.freeze());
  }

  count(): Promise<number> {
    return countRows(this.freeze());
  }

  exists(): Promise<boolean> {
    return existsRows(this.freeze());
  }

  paginate(page: number, perPage: number): Promise<PaginatedResult> {
    return readPage(this.freeze(), page, perPage);
  }

  pluck(field: string): Promise<unknown[]> {
    if (isUndefined(this.meta.fields[field])) throw unknownFieldError(field, this.meta);
    return pluckRows(this.freeze(), field);
  }

  create(input: Record<string, unknown>): Promise<CreateOutcome> {
    if (this.meta.singleton) throw singletonRefuses(this.meta.collection, 'create');
    return runCreate(
      this.meta.collection,
      input,
      this.localeValue,
      this.joinedTx,
      this.unscopedChain,
      this.linkResolver,
    );
  }

  async createOrThrow(input: Record<string, unknown>): Promise<QueryRecord> {
    if (this.meta.singleton) throw singletonRefuses(this.meta.collection, 'create');
    const outcome = await runCreate(
      this.meta.collection,
      input,
      this.localeValue,
      this.joinedTx,
      this.unscopedChain,
      this.linkResolver,
    );
    if (!outcome.ok) throw validationError(outcome.errors);
    return outcome.record;
  }

  update(input: Record<string, unknown>): Promise<UpdateOutcome> {
    return runUpdate(
      this.meta.collection,
      input,
      this.requireCondition('update'),
      this.localeValue,
      this.joinedTx,
      this.unscopedChain,
      this.linkResolver,
      freezeConditions(this.accessNodes),
    );
  }

  async updateOrThrow(input: Record<string, unknown>): Promise<QueryRecord[]> {
    const outcome = await runUpdate(
      this.meta.collection,
      input,
      this.requireCondition('update'),
      this.localeValue,
      this.joinedTx,
      this.unscopedChain,
      this.linkResolver,
      freezeConditions(this.accessNodes),
    );
    if (!outcome.ok) throw validationError(outcome.errors);
    return outcome.records;
  }

  delete(): Promise<DeleteOutcome> {
    if (this.meta.singleton) throw singletonRefuses(this.meta.collection, 'delete');
    if (!isNull(this.localeValue)) {
      throw ohneError({
        title: `Cannot \`delete\` a locale-scoped query`,
        body: [
          `This query is scoped to \`${this.localeValue}\`, but \`delete\` removes whole records - every locale at once.`,
          'Use `deleteTranslation` to remove this locale, or drop `.locale()` to delete records.',
        ],
      });
    }
    return runDelete(
      this.meta.collection,
      this.requireCondition('delete'),
      this.joinedTx,
      this.unscopedChain,
    );
  }

  deleteTranslation(): Promise<DeleteOutcome> {
    if (isNull(this.localeValue)) {
      throw ohneError({
        title: 'Cannot `deleteTranslation` without a locale',
        body: [
          `Scope the query with \`.locale()\` first; the chain's locale names the translation to remove.`,
        ],
      });
    }
    return runDeleteTranslation(
      this.meta.collection,
      this.requireCondition('deleteTranslation'),
      this.localeValue,
      this.joinedTx,
      this.unscopedChain,
    );
  }

  use(tx: Transaction): this {
    this.joinedTx = tx;
    return this;
  }

  unscoped(): this {
    this.unscopedChain = true;
    return this;
  }

  linkReach(resolve: ReachResolver): this {
    this.linkResolver = resolve;
    return this;
  }

  /**
   * Folds the accumulated conditions into one node, refusing a write that would touch every record.
   * The typed `ReadyQuery` state already gates this, so the throw catches only an untyped caller.
   * A singleton's writes need no filter: an empty `and` matches its one record.
   */
  private requireCondition(operation: 'update' | 'delete' | 'deleteTranslation'): ConditionNode {
    const condition = readCondition(this.freeze());
    if (!isNull(condition)) return condition;
    if (this.meta.singleton) return { kind: 'and', nodes: [] };
    throw ohneError({
      title: `Cannot \`${operation}\` without a filter`,
      body: [
        `A \`${operation}\` on \`${this.meta.collection}\` must be narrowed by \`where\` or \`whereAny\` first.`,
        'An unfiltered write would touch every record, so the builder requires a condition.',
      ],
    });
  }

  /**
   * Snapshots the accumulated state into an immutable IR for a terminal to compile and execute.
   */
  private freeze(): QueryIR {
    return freezeIR({
      collection: this.meta.collection,
      conditions: this.conditions,
      select: this.selected,
      order: this.orderKeys,
      limit: this.limitValue,
      offset: this.offsetValue,
      populate: this.populateNodes,
      locale: this.localeValue,
      access: this.accessNodes,
      wire: this.wireState,
      unscoped: this.unscopedChain,
    });
  }
}

/**
 * The failure a singleton raises for the operations it never has.
 */
function singletonRefuses(
  collection: string,
  operation: 'create' | 'delete',
): ReturnType<typeof ohneError> {
  return ohneError({
    title: `Cannot \`${operation}\` on singleton \`${collection}\``,
    body: [
      'A singleton holds exactly one record, created when the schema syncs.',
      operation === 'create'
        ? 'Use `update` to change it.'
        : 'Use `deleteTranslation` on a locale-scoped chain to drop one locale.',
    ],
  });
}

/**
 * Resolves either `where` form into the object condition the AST parser reads.
 * A field name plus value (or callback) lowers to the object grammar; an object passes straight through.
 */
function toConditionInput(
  fieldOrCondition: string | ConditionInput,
  value: unknown,
): ConditionInput {
  return isString(fieldOrCondition) ? lowerField(fieldOrCondition, value) : fieldOrCondition;
}

/**
 * Parses and gates one condition-object input into an AST node.
 * Every `where`, `access`, and branch shares it, and so does the `admittedUUIDs` probe.
 * A malformed shape throws naming the parse code and its path; an inapplicable leaf throws through gating.
 */
export function toConditionNode(
  condition: ConditionInput,
  meta: CollectionQueryMeta,
): ConditionNode {
  const parsed = parseCondition(condition);
  if (!parsed.ok) {
    const { code, path } = parsed.error;
    throw ohneError({
      title: `Invalid condition on \`${meta.collection}\``,
      body: [`The condition is malformed (${code})${path === '' ? '' : ` at \`${path}\``}.`],
    });
  }
  validateCondition(parsed.node, meta);
  return parsed.node;
}

/**
 * One OR branch: it accumulates ANDed conditions and folds them into an `and` node on demand.
 */
class ConditionBranch implements UntypedWhereBranch {
  private readonly nodes: ConditionNode[] = [];
  private readonly meta: CollectionQueryMeta;

  constructor(meta: CollectionQueryMeta) {
    this.meta = meta;
  }

  where(fieldOrCondition: string | ConditionInput, value?: unknown): this {
    this.nodes.push(toConditionNode(toConditionInput(fieldOrCondition, value), this.meta));
    return this;
  }

  whereAny(build: WhereGroupBuild): this {
    this.nodes.push(orGroup(build, this.meta));
    return this;
  }

  /**
   * The branch as one node: its conditions ANDed.
   * An empty branch is `and([])`, which matches all.
   */
  toNode(): ConditionNode {
    return { kind: 'and', nodes: [...this.nodes] };
  }
}

/**
 * Runs a `whereAny` callback and folds its branches into one `or` node.
 * Zero branches yield `or([])`, which matches nothing - the same single point as an empty wire `or`.
 */
function orGroup(build: WhereGroupBuild, meta: CollectionQueryMeta): ConditionNode {
  const group: UntypedWhereGroup = {
    where: (fieldOrCondition: string | ConditionInput, value?: unknown) =>
      new ConditionBranch(meta).where(fieldOrCondition, value),
    whereAny: (nested) => new ConditionBranch(meta).whereAny(nested),
  };
  const branches = build(group);
  return { kind: 'or', nodes: branches.map((branch) => (branch as ConditionBranch).toNode()) };
}
