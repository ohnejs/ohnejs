import type { CompareOperator, ConditionNode } from '../../../utils/index.ts';
import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { blockQueryMetadata, queryMetadata } from '../metadata.ts';
import { splitBlockHas } from '../validate-condition.ts';
import { escapeLike } from './escape-like.ts';
import { inFragment, joinFragments, rawFragment, type SQLFragment } from './fragment.ts';
import { conditionUsesCompanion } from './from.ts';

/**
 * A condition scope: the fields a leaf may address and how their columns are referenced.
 *
 * `self` is the quoted identifier a correlated child subquery references this scope's columns by.
 * It is the main table name at the top level, a `_subN` alias inside an `EXISTS`.
 * `companionSelf` is the quoted alias or table the scope's companion columns reference through.
 * `qualified` is whether this scope's own leaves prefix their columns.
 * The top-level `WHERE` reads bare columns (main and companion columns are disjoint).
 * A subquery qualifies by its aliases.
 */
interface WhereScope {
  fields: Record<string, FieldQueryMeta>;
  self: string;
  companionSelf?: string;
  qualified: boolean;
}

/**
 * The per-compile state: the `_subN` alias counter and the effective locale.
 * Every companion join and locale-scoped table binds the locale.
 * One counter threads the whole tree, so nested and self-referential relations never share an alias.
 */
interface CompileContext {
  n: number;
  locale: string;
}

/**
 * Compiles a condition AST into a `WHERE`-clause fragment over a collection's main table.
 *
 * `and`/`or` groups render parenthesized and join their children; an empty group is a constant.
 * An empty `and` matches all (`1 = 1`), an empty `or` matches nothing (`1 = 0`) - the one place both render.
 * A `compare` leaf renders its operator over the field's column.
 * `has`/`empty` render correlated `EXISTS` subqueries per kind, aliased `_subN` from one counter.
 * A locale-scoped junction or child table adds its `_localeCode` predicate.
 * An `EXISTS` target whose condition addresses companion columns joins its companion at the locale.
 * Negation wraps the positive fragment in `NOT (...)`; parsing already folded `not` groups by De Morgan.
 * Every value binds through a `?`, so nothing inlines into the SQL.
 */
export function compileWhere(
  node: ConditionNode,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  locale: string,
): SQLFragment {
  const scope: WhereScope = {
    fields: meta.fields,
    self: dialect.quote(meta.table),
    ...(isUndefined(meta.companionTable)
      ? {}
      : { companionSelf: dialect.quote(meta.companionTable) }),
    qualified: false,
  };
  return compileNode(node, scope, dialect, { n: 0, locale });
}

/**
 * Compiles one AST node within `scope`, drawing aliases and the locale from the shared context.
 */
function compileNode(
  node: ConditionNode,
  scope: WhereScope,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  switch (node.kind) {
    case 'and':
      return group(node.nodes, ' AND ', '1 = 1', scope, dialect, ctx);
    case 'or':
      return group(node.nodes, ' OR ', '1 = 0', scope, dialect, ctx);
    case 'compare': {
      const field = scope.fields[node.path[0]];
      const fragment = compareFragment(
        node.op,
        fieldRef(scope, field, dialect),
        field.logicalType as LogicalType,
        node.value,
        dialect,
      );
      return negateIf(node.negated, fragment);
    }
    case 'has':
      return negateIf(node.negated, compileHas(node, scope, dialect, ctx));
    case 'empty':
      return negateIf(node.negated, compileEmpty(node, scope, dialect, ctx));
  }
}

/**
 * Joins a group's children with `separator`, parenthesizing the result; an empty group is `constant`.
 */
function group(
  nodes: readonly ConditionNode[],
  separator: string,
  constant: string,
  scope: WhereScope,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  if (nodes.length === 0) return rawFragment(constant);
  const fragments = nodes.map((child) => compileNode(child, scope, dialect, ctx));
  if (fragments.length === 1) return fragments[0];
  const joined = joinFragments(fragments, separator);
  return { sql: `(${joined.sql})`, params: joined.params };
}

/**
 * References a field's column: bare at the top level, prefixed inside a subquery.
 * A companion-resident column qualifies through the scope's companion alias, never `self`.
 */
function fieldRef(scope: WhereScope, field: FieldQueryMeta, dialect: Dialect): string {
  if (!scope.qualified) return dialect.quote(field.column as string);
  return qualifiedFieldRef(scope, field, dialect);
}

/**
 * References a field's column always prefixed with its home table - the correlation form.
 * A correlation predicate lives inside the subquery, whose `FROM` would capture a bare outer column.
 * So it qualifies even from the top-level scope.
 */
function qualifiedFieldRef(scope: WhereScope, field: FieldQueryMeta, dialect: Dialect): string {
  const table = field.companion === true ? (scope.companionSelf as string) : scope.self;
  return `${table}.${dialect.quote(field.column as string)}`;
}

/**
 * References this scope's identity column for a child subquery's correlation predicate.
 */
function selfUUID(scope: WhereScope, dialect: Dialect): string {
  return `${scope.self}.${dialect.quote('UUID')}`;
}

/**
 * Wraps `fragment` in `NOT (...)` when the leaf is negated, leaving it untouched otherwise.
 */
function negateIf(negated: boolean, fragment: SQLFragment): SQLFragment {
  return negated ? { sql: `NOT (${fragment.sql})`, params: fragment.params } : fragment;
}

/**
 * Compiles `has` per relation kind: a record's non-null foreign key, or an `EXISTS` over the relation.
 * A bare `record` `has` is its foreign key being set; a conditioned one probes the target row.
 * A conditioned `blocks` `has` pins the wrapper to its discriminated type.
 * A bare one is wrapper existence, riding the child shape.
 */
function compileHas(
  node: Extract<ConditionNode, { kind: 'has' }>,
  scope: WhereScope,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const field = scope.fields[node.path[0]];
  if (field.kind === 'record') {
    if (isNull(node.condition)) {
      return rawFragment(`${fieldRef(scope, field, dialect)} IS NOT NULL`);
    }
    return recordExists(field, scope, node.condition, dialect, ctx);
  }
  if (field.kind === 'records') return recordsExists(field, scope, node.condition, dialect, ctx);
  if (field.kind === 'blocks' && !isNull(node.condition)) {
    return blocksExists(field, scope, node.condition, dialect, ctx);
  }
  return childExists(field, scope, node.condition, dialect, ctx);
}

/**
 * Compiles `empty` per relation kind: a record's null foreign key, or the negation of the relation's `EXISTS`.
 */
function compileEmpty(
  node: Extract<ConditionNode, { kind: 'empty' }>,
  scope: WhereScope,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const field = scope.fields[node.path[0]];
  if (field.kind === 'record') {
    return rawFragment(`${fieldRef(scope, field, dialect)} IS NULL`);
  }
  const existence =
    field.kind === 'records'
      ? recordsExists(field, scope, null, dialect, ctx)
      : childExists(field, scope, null, dialect, ctx);
  return { sql: `NOT ${existence.sql}`, params: existence.params };
}

/**
 * `EXISTS` over a `record`'s target, correlating the target's `UUID` to the parent's foreign key.
 */
function recordExists(
  field: FieldQueryMeta,
  scope: WhereScope,
  condition: ConditionNode,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const alias = dialect.quote(nextAlias(ctx));
  const target = queryMetadata(field.target as string);
  const companion = companionJoin(target, alias, condition, dialect, ctx);
  const from = {
    sql: `${dialect.quote(target.table)} ${alias}${companion.sql}`,
    params: companion.params,
  };
  const correlation = rawFragment(
    `${alias}.${dialect.quote('UUID')} = ${qualifiedFieldRef(scope, field, dialect)}`,
  );
  const inner: WhereScope = {
    fields: target.fields,
    self: alias,
    qualified: true,
    ...(isUndefined(companion.companionSelf) ? {} : { companionSelf: companion.companionSelf }),
  };
  return existsFragment(from, correlation, condition, inner, dialect, ctx);
}

/**
 * `EXISTS` over a `records` junction, correlating the parent-side link to the parent's `UUID`.
 * A conditioned probe joins the target table so the nested condition can address it.
 * The inverse side swaps which junction column links the parent and which links the target.
 * A locale-scoped junction holds one link list per locale, so its correlation binds the locale too.
 */
function recordsExists(
  field: FieldQueryMeta,
  scope: WhereScope,
  condition: ConditionNode | null,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const junction = dialect.quote(nextAlias(ctx));
  const [parentLink, targetLink] =
    field.inverse === true ? ['_targetUUID', '_parentUUID'] : ['_parentUUID', '_targetUUID'];
  const correlation = scopedCorrelation(
    `${junction}.${dialect.quote(parentLink)} = ${selfUUID(scope, dialect)}`,
    field,
    junction,
    dialect,
    ctx,
  );
  const junctionFrom = `${dialect.quote(field.table as string)} ${junction}`;
  if (isNull(condition)) {
    return existsFragment(rawFragment(junctionFrom), correlation, null, scope, dialect, ctx);
  }
  const targetAlias = dialect.quote(nextAlias(ctx));
  const target = queryMetadata(field.target as string);
  const join = `JOIN ${dialect.quote(target.table)} ${targetAlias} ON ${targetAlias}.${dialect.quote('UUID')} = ${junction}.${dialect.quote(targetLink)}`;
  const companion = companionJoin(target, targetAlias, condition, dialect, ctx);
  const from = { sql: `${junctionFrom} ${join}${companion.sql}`, params: companion.params };
  const inner: WhereScope = {
    fields: target.fields,
    self: targetAlias,
    qualified: true,
    ...(isUndefined(companion.companionSelf) ? {} : { companionSelf: companion.companionSelf }),
  };
  return existsFragment(from, correlation, condition, inner, dialect, ctx);
}

/**
 * `EXISTS` over a composite's child table, correlating the child's `_parentUUID` to the parent's `UUID`.
 * A locale-scoped child table holds one item set per locale, so its correlation binds the locale too.
 */
function childExists(
  field: FieldQueryMeta,
  scope: WhereScope,
  condition: ConditionNode | null,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const alias = dialect.quote(nextAlias(ctx));
  const from = rawFragment(`${dialect.quote(field.table as string)} ${alias}`);
  const correlation = scopedCorrelation(
    `${alias}.${dialect.quote('_parentUUID')} = ${selfUUID(scope, dialect)}`,
    field,
    alias,
    dialect,
    ctx,
  );
  const inner: WhereScope = {
    fields: field.subfields as Record<string, FieldQueryMeta>,
    self: alias,
    qualified: true,
  };
  return existsFragment(from, correlation, condition, inner, dialect, ctx);
}

/**
 * `EXISTS` over a blocks field's wrapper, correlated on `_parentUUID` with the type pinned.
 * Validation guarantees the discriminator; it compiles alone into the wrapper's `_blockType` predicate.
 * A scope addressing subfields joins the type's shared table on `_blockUUID` and compiles against it.
 * A locale-scoped wrapper holds one block list per locale, so its correlation binds the locale too.
 */
function blocksExists(
  field: FieldQueryMeta,
  scope: WhereScope,
  condition: ConditionNode,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const split = splitBlockHas(condition);
  if (!split.ok) {
    throw ohneError('A blocks `has` reached the compiler without its `block` discriminator');
  }
  const wrapper = dialect.quote(nextAlias(ctx));
  const correlation = scopedCorrelation(
    `${wrapper}.${dialect.quote('_parentUUID')} = ${selfUUID(scope, dialect)}`,
    field,
    wrapper,
    dialect,
    ctx,
  );
  const typed = {
    sql: `${correlation.sql} AND ${wrapper}.${dialect.quote('_blockType')} = ?`,
    params: [...correlation.params, split.block],
  };
  const wrapperFrom = `${dialect.quote(field.table as string)} ${wrapper}`;
  if (isNull(split.rest)) {
    return existsFragment(rawFragment(wrapperFrom), typed, null, scope, dialect, ctx);
  }
  const alias = dialect.quote(nextAlias(ctx));
  const block = blockQueryMetadata(split.block);
  const join = `JOIN ${dialect.quote(block.table)} ${alias} ON ${alias}.${dialect.quote('UUID')} = ${wrapper}.${dialect.quote('_blockUUID')}`;
  const inner: WhereScope = { fields: block.fields, self: alias, qualified: true };
  return existsFragment(
    { sql: `${wrapperFrom} ${join}`, params: [] },
    typed,
    split.rest,
    inner,
    dialect,
    ctx,
  );
}

/**
 * Appends the `_localeCode` predicate to a derived table's correlation when the field is locale-scoped.
 */
function scopedCorrelation(
  correlation: string,
  field: FieldQueryMeta,
  alias: string,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  if (field.localeScoped !== true) return rawFragment(correlation);
  return {
    sql: `${correlation} AND ${alias}.${dialect.quote('_localeCode')} = ?`,
    params: [ctx.locale],
  };
}

/**
 * The optional companion join of an `EXISTS` target, aliased fresh.
 * Present when the nested condition addresses companion columns.
 * `LEFT`, so an untranslated target still reads, its companion columns `NULL`.
 */
function companionJoin(
  target: CollectionQueryMeta,
  selfAlias: string,
  condition: ConditionNode | null,
  dialect: Dialect,
  ctx: CompileContext,
): { sql: string; params: SQLValue[]; companionSelf?: string } {
  if (
    isUndefined(target.companionTable) ||
    isNull(condition) ||
    !conditionUsesCompanion(condition, target.fields)
  ) {
    return { sql: '', params: [] };
  }
  const companion = dialect.quote(nextAlias(ctx));
  const parent = `${companion}.${dialect.quote('_parentUUID')} = ${selfAlias}.${dialect.quote('UUID')}`;
  const scoped = `${companion}.${dialect.quote('_localeCode')} = ?`;
  return {
    sql: ` LEFT JOIN ${dialect.quote(target.companionTable)} ${companion} ON ${parent} AND ${scoped}`,
    params: [ctx.locale],
    companionSelf: companion,
  };
}

/**
 * Assembles an `EXISTS (SELECT 1 FROM ... WHERE <correlation> [AND <condition>])` fragment.
 * A `null` condition tests bare existence; otherwise the condition compiles within `inner`.
 */
function existsFragment(
  from: SQLFragment,
  correlation: SQLFragment,
  condition: ConditionNode | null,
  inner: WhereScope,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  if (isNull(condition)) {
    return {
      sql: `EXISTS (SELECT 1 FROM ${from.sql} WHERE ${correlation.sql})`,
      params: [...from.params, ...correlation.params],
    };
  }
  const cond = compileNode(condition, inner, dialect, ctx);
  return {
    sql: `EXISTS (SELECT 1 FROM ${from.sql} WHERE ${correlation.sql} AND ${cond.sql})`,
    params: [...from.params, ...correlation.params, ...cond.params],
  };
}

/**
 * Hands out the next `_subN` alias, bumping the shared counter.
 */
function nextAlias(ctx: CompileContext): string {
  return `_sub${ctx.n++}`;
}

/**
 * Compiles one operator over an already-quoted column into its positive fragment.
 */
function compareFragment(
  op: CompareOperator,
  column: string,
  type: LogicalType,
  value: unknown,
  dialect: Dialect,
): SQLFragment {
  switch (op) {
    case 'equalsTo':
      return { sql: `${column} = ?`, params: [dialect.serialize(type, value)] };
    case 'in':
      return inFragment(
        column,
        (value as unknown[]).map((item) => dialect.serialize(type, item)),
      );
    case 'greaterThan':
      return { sql: `${column} > ?`, params: [dialect.serialize(type, value)] };
    case 'atLeast':
      return { sql: `${column} >= ?`, params: [dialect.serialize(type, value)] };
    case 'lessThan':
      return { sql: `${column} < ?`, params: [dialect.serialize(type, value)] };
    case 'atMost':
      return { sql: `${column} <= ?`, params: [dialect.serialize(type, value)] };
    case 'contains':
      return { sql: dialect.textMatch(column), params: [`%${escapeLike(value as string)}%`] };
    case 'startsWith':
      return { sql: dialect.textMatch(column), params: [`${escapeLike(value as string)}%`] };
    case 'endsWith':
      return { sql: dialect.textMatch(column), params: [`%${escapeLike(value as string)}`] };
    case 'like':
      return { sql: `${column} LIKE ?`, params: [value as SQLValue] };
    case 'isNull':
      return { sql: `${column} IS NULL`, params: [] };
    case 'includes':
    case 'includesAll':
    case 'includesAny':
      throw ohneError('List-membership operators do not reach the scalar compiler');
  }
}
