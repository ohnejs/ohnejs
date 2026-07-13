import type { ConditionNode } from '../../utils/index.ts';
import type { OrderDirection, OrderEntry } from './ir.ts';
import type { CollectionQueryMeta } from './metadata.ts';
import type { QueryRecord } from './read/find.ts';
import type { PaginatedResult } from './read/paginate.ts';
import type {
  ConditionInput,
  UntypedQueryBuilder,
  UntypedWhereBranch,
  UntypedWhereGroup,
  WhereGroupBuild,
} from './untyped.ts';
import type { QueryLimits } from './wire/limits.ts';

import { isString, isUndefined, parseCondition } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { freezeIR, type QueryIR } from './ir.ts';
import { count as countRows, exists as existsRows } from './read/count.ts';
import { findFirst as readFirst, findMany as readMany } from './read/find.ts';
import { paginate as readPage } from './read/paginate.ts';
import { pluck as pluckRows } from './read/pluck.ts';
import { unknownFieldError, validateCondition } from './validate-condition.ts';
import { lowerField } from './where-field.ts';

/**
 * The one runtime query builder every typed state and the wire path drive.
 *
 * It accumulates plain state and freezes an immutable `QueryIR` when a terminal runs.
 * `where` AND-appends, `select` and the sort keys accumulate, `limit`/`offset` replace.
 * Each accumulation is append-only: no call silently discards a prior one.
 */
export class QueryBuilderImpl implements UntypedQueryBuilder {
  private readonly conditions: ConditionNode[] = [];
  private readonly orderKeys: OrderEntry[] = [];
  private readonly populateFields: string[] = [];
  private selected: string[] | null = null;
  private limitValue: number | null = null;
  private offsetValue: number | null = null;
  readonly limitOverrides: Partial<QueryLimits> = {};
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

  select(...fields: string[]): this {
    for (const field of fields) {
      if (isUndefined(this.meta.fields[field])) throw unknownFieldError(field, this.meta);
    }
    this.selected = [...(this.selected ?? []), ...fields];
    return this;
  }

  populate(...fields: string[]): this {
    for (const field of fields) {
      const entry = this.meta.fields[field];
      if (isUndefined(entry)) throw unknownFieldError(field, this.meta);
      if (entry.kind !== 'record' && entry.kind !== 'records') {
        throw ohneError({
          title: `Cannot populate \`${field}\``,
          body: [
            `Field \`${field}\` on collection \`${this.meta.collection}\` is not a relation; only \`record\` and \`records\` fields populate.`,
          ],
        });
      }
      this.populateFields.push(field);
    }
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

  limits(overrides: Partial<QueryLimits>): this {
    Object.assign(this.limitOverrides, overrides);
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
      populate: this.populateFields,
    });
  }
}

/**
 * Reads the wire-limit overrides a builder accumulated, the internal seam the wire parser resolves through.
 */
export function builderLimits(builder: UntypedQueryBuilder): Partial<QueryLimits> {
  return (builder as QueryBuilderImpl).limitOverrides;
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
 * Parses and gates one condition-object input into an AST node, the step `where` and every branch share.
 * A malformed shape throws naming the parse code and its path; an inapplicable leaf throws through gating.
 */
function toConditionNode(condition: ConditionInput, meta: CollectionQueryMeta): ConditionNode {
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
