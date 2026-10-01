import type { CompareOperator, ConditionNode } from '../../../utils/index.ts';
import type { SQLValue } from '../../database/adapter.ts';
import type { Dialect, ListMembershipOperator, LogicalType } from '../../database/dialect.ts';
import type { QueryIR, TargetReach } from '../ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';

import {
  foldCase,
  intersection,
  isASCII,
  isEmpty,
  isNull,
  isUndefined,
  toArray,
  uniqueArray,
} from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import { splitBlockHas } from '../block-has.ts';
import { queryLocales } from '../locale.ts';
import { blockQueryMetadata, queryMetadata } from '../metadata.ts';
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
 * A subquery's tie to its outer row: an inner column equal to an outer one, plus any pin on the inner rows.
 * The pin is the locale a locale-scoped table binds and the type a blocks wrapper narrows to.
 * `keyed` marks `outer` as the scope's never-null `UUID`, the one shape an uncorrelated `IN` may replace.
 * Over a nullable foreign key, `NOT (fk IN (...))` would drop a `NULL` row that `NOT EXISTS` keeps.
 */
interface Correlation {
  inner: string;
  outer: string;
  pin: SQLFragment | null;
  keyed: boolean;
}

/**
 * The per-compile state: the `_subN` alias counter, the effective locale, and the wire reach in force.
 * Every companion join and locale-scoped table binds the locale.
 * One counter threads the whole tree, so nested and self-referential relations never share an alias.
 * `reach` is set only while a wire read's own condition compiles; a trusted condition compiles under `null`.
 */
interface CompileContext {
  n: number;
  locale: string;
  reach: ReadonlyMap<string, TargetReach> | null;
}

/**
 * Compiles a condition AST into a `WHERE`-clause fragment over a collection's main table.
 *
 * `and`/`or` groups render parenthesized and join their children; an empty group is a constant.
 * An empty `and` matches all (`1 = 1`), an empty `or` matches nothing (`1 = 0`) - the one place both render.
 * A `compare` leaf renders its operator over the field's column.
 * `has`/`empty` render correlated `EXISTS` subqueries per kind, aliased `_subN` from one counter.
 * An identity-only `has` renders an uncorrelated `UUID IN (SELECT ...)` instead, which searches by key.
 * `records` membership probes the junction alone the same way, never joining the target.
 * A locale-scoped junction or child table adds its `_localeCode` predicate.
 * An `EXISTS` target whose condition addresses companion columns joins its companion at the locale.
 * Negation wraps the positive fragment in `NOT (...)`; parsing already folded `not` groups by De Morgan.
 * A list-membership leaf keeps its non-`NULL` column guard outside that `NOT`, per the evaluator's rule.
 * One over `_translations` probes the collection's locale-scoped tables instead of a column.
 * Every value binds through a `?`, so nothing inlines into the SQL.
 */
export function compileWhere(
  node: ConditionNode,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  locale: string,
): SQLFragment {
  return compileNode(node, rootScope(meta, dialect), dialect, { n: 0, locale, reach: null });
}

/**
 * Compiles a read's `WHERE`: its trusted condition, then a wire read's own condition under its reach.
 * The two AND together; `null` when the read has neither.
 * The reach applies to the wire half alone, so a scope's own `has` probes stay whole.
 */
export function compileReadWhere(
  ir: QueryIR,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  locale: string,
): SQLFragment | null {
  const wire = isNull(ir.wire) ? null : ir.wire.condition;
  if (isNull(ir.condition) && isNull(wire)) return null;
  const scope = rootScope(meta, dialect);
  const ctx: CompileContext = { n: 0, locale, reach: null };
  const parts: SQLFragment[] = [];
  if (!isNull(ir.condition)) parts.push(compileNode(ir.condition, scope, dialect, ctx));
  if (!isNull(wire) && !isNull(ir.wire)) {
    ctx.reach = ir.wire.reach;
    parts.push(compileNode(wire, scope, dialect, ctx));
  }
  if (parts.length === 1) return parts[0];
  return {
    sql: parts.map((part) => `(${part.sql})`).join(' AND '),
    params: parts.flatMap((part) => part.params),
  };
}

/**
 * The top-level scope: bare column references over the main table and its companion.
 */
function rootScope(meta: CollectionQueryMeta, dialect: Dialect): WhereScope {
  return {
    fields: meta.fields,
    self: dialect.quote(meta.table),
    ...(isUndefined(meta.companionTable)
      ? {}
      : { companionSelf: dialect.quote(meta.companionTable) }),
    qualified: false,
  };
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
      if (node.op === 'includes' || node.op === 'includesAll' || node.op === 'includesAny') {
        if (field.kind === 'translations') {
          return negateIf(node.negated, translationsFragment(node, scope, field, dialect, ctx));
        }
        if (field.kind === 'records') {
          return negateIf(node.negated, recordsMembership(node, scope, field, dialect, ctx));
        }
        return membershipFragment(node, scope, field, dialect);
      }
      if (node.op === 'in' && node.negated && isEmpty(node.value)) {
        // The empty-set probe is column-free, so a bare `NOT` over it would match `NULL` rows.
        return rawFragment(`${fieldRef(scope, field, dialect)} IS NOT NULL`);
      }
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
  if (isEmpty(nodes)) return rawFragment(constant);
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
 * Compiles a list-membership leaf through the dialect over its `json` list column.
 * The non-`NULL` guard stays outside the negation: a `NULL` list matches nothing, negated or not.
 * That mirrors the evaluator's rule for a nullish resolved value.
 */
function membershipFragment(
  node: Extract<ConditionNode, { kind: 'compare' }>,
  scope: WhereScope,
  field: FieldQueryMeta,
  dialect: Dialect,
): SQLFragment {
  const column = fieldRef(scope, field, dialect);
  const values = node.op === 'includes' ? [node.value] : (node.value as unknown[]);
  const match = dialect.listMembership(column, node.op as ListMembershipOperator, values);
  const probe = node.negated ? `NOT (${match.sql})` : match.sql;
  return { sql: `(${column} IS NOT NULL AND ${probe})`, params: match.params };
}

/**
 * Compiles a list-membership leaf over `_translations`, probing the very rows `loadTranslations` reads.
 * One `UNION ALL` source spans `field.tables`, so a locale binds once however many tables hold rows.
 * `includesAll` ANDs one `EXISTS` per locale: each flattens onto the tables' `_parentUUID` indexes.
 * A counted `DISTINCT` over the source would not, and scans it whole per row.
 * A locale the configuration does not name never lists on a read, so here it matches nothing.
 * The context's locale never binds: the entry spans every locale at once.
 */
function translationsFragment(
  node: Extract<ConditionNode, { kind: 'compare' }>,
  scope: WhereScope,
  field: FieldQueryMeta,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const all = node.op === 'includesAll';
  const wanted = uniqueArray(
    node.op === 'includes' ? [node.value as string] : (node.value as string[]),
  );
  if (isEmpty(wanted)) return rawFragment(all ? '1 = 1' : '1 = 0');
  const held = intersection(queryLocales().locales, wanted);
  if (all ? held.length < wanted.length : isEmpty(held)) return rawFragment('1 = 0');

  const parent = dialect.quote('_parentUUID');
  const locale = dialect.quote('_localeCode');
  const source = (field.tables as readonly string[])
    .map((table) => `SELECT ${parent}, ${locale} FROM ${dialect.quote(table)}`)
    .join(' UNION ALL ');
  const exists = (locales: readonly string[]): SQLFragment => {
    const alias = dialect.quote(nextAlias(ctx));
    const match = inFragment(`${alias}.${locale}`, locales);
    return {
      sql: `EXISTS (SELECT 1 FROM (${source}) ${alias} WHERE ${alias}.${parent} = ${selfUUID(scope, dialect)} AND ${match.sql})`,
      params: match.params,
    };
  };
  if (!all || held.length === 1) return exists(held);
  const joined = joinFragments(
    held.map((code) => exists([code])),
    ' AND ',
  );
  return { sql: `(${joined.sql})`, params: joined.params };
}

/**
 * Compiles `includes`/`includesAny` over a `records` field: the parents whose junction links a target.
 * It reads the junction alone, so no target row is joined and no reach into the target applies.
 * The inverse side swaps the link columns, and a locale-scoped junction binds the locale, as `has` does.
 */
function recordsMembership(
  node: Extract<ConditionNode, { kind: 'compare' }>,
  scope: WhereScope,
  field: FieldQueryMeta,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const targets = uniqueArray(toArray(node.value) as SQLValue[]);
  if (isEmpty(targets)) return rawFragment('1 = 0');
  const junction = dialect.quote(nextAlias(ctx));
  const [parentLink, targetLink] = junctionLinks(field, dialect);
  const match = inFragment(`${junction}.${targetLink}`, targets);
  const pin = localePin(field, junction, dialect, ctx);
  const where = isNull(pin) ? match : joinFragments([match, pin], ' AND ');
  return {
    sql: `${selfUUID(scope, dialect)} IN (SELECT ${junction}.${parentLink} FROM ${dialect.quote(field.table as string)} ${junction} WHERE ${where.sql})`,
    params: where.params,
  };
}

/**
 * A junction's quoted parent-side and target-side link columns, swapped on the inverse side.
 */
function junctionLinks(field: FieldQueryMeta, dialect: Dialect): [string, string] {
  const [parent, target] =
    field.inverse === true ? ['_targetUUID', '_parentUUID'] : ['_parentUUID', '_targetUUID'];
  return [dialect.quote(parent), dialect.quote(target)];
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
 * Compiles `empty` per relation kind: a record's null foreign key, or the relation's negated `EXISTS`.
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
  const target = queryMetadata(field.target as string);
  const reach = probeReach(target, ctx);
  if (reach === false) return rawFragment('1 = 0');
  const alias = dialect.quote(nextAlias(ctx));
  const companion = companionJoin(target, alias, withReach(condition, reach), dialect, ctx);
  const from = {
    sql: `${dialect.quote(target.table)} ${alias}${companion.sql}`,
    params: companion.params,
  };
  const correlation: Correlation = {
    inner: `${alias}.${dialect.quote('UUID')}`,
    outer: qualifiedFieldRef(scope, field, dialect),
    pin: null,
    keyed: false,
  };
  const inner: WhereScope = {
    fields: target.fields,
    self: alias,
    qualified: true,
    ...(isUndefined(companion.companionSelf) ? {} : { companionSelf: companion.companionSelf }),
  };
  return existsFragment(from, correlation, condition, inner, dialect, ctx, reach);
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
  const [parentLink, targetLink] = junctionLinks(field, dialect);
  const correlation = childCorrelation(
    `${junction}.${parentLink}`,
    scope,
    field,
    junction,
    dialect,
    ctx,
  );
  const junctionFrom = `${dialect.quote(field.table as string)} ${junction}`;
  if (isNull(condition)) {
    return existsFragment(rawFragment(junctionFrom), correlation, null, scope, dialect, ctx);
  }
  const target = queryMetadata(field.target as string);
  const reach = probeReach(target, ctx);
  if (reach === false) return rawFragment('1 = 0');
  const targetAlias = dialect.quote(nextAlias(ctx));
  const join = `JOIN ${dialect.quote(target.table)} ${targetAlias} ON ${targetAlias}.${dialect.quote('UUID')} = ${junction}.${targetLink}`;
  const companion = companionJoin(target, targetAlias, withReach(condition, reach), dialect, ctx);
  const from = { sql: `${junctionFrom} ${join}${companion.sql}`, params: companion.params };
  const inner: WhereScope = {
    fields: target.fields,
    self: targetAlias,
    qualified: true,
    ...(isUndefined(companion.companionSelf) ? {} : { companionSelf: companion.companionSelf }),
  };
  return existsFragment(from, correlation, condition, inner, dialect, ctx, reach);
}

/**
 * A wire read's reach into a conditioned probe's target.
 * `null` when the compile is trusted or the reach carries no condition.
 * `false` cuts the probe off: a target the read cannot reach, or never resolved, matches no row.
 */
function probeReach(
  target: CollectionQueryMeta,
  ctx: CompileContext,
): ConditionNode | false | null {
  if (isNull(ctx.reach)) return null;
  const reach = ctx.reach.get(target.collection);
  if (isUndefined(reach) || reach === false) return false;
  return reach.condition;
}

/**
 * The probe's condition with its reach ANDed in, the shape a companion-join decision reads.
 */
function withReach(condition: ConditionNode, reach: ConditionNode | null): ConditionNode {
  return isNull(reach) ? condition : { kind: 'and', nodes: [condition, reach] };
}

/**
 * Compiles a reach condition as the trusted scope it is, with the wire reach lifted for its subtree.
 */
function compileTrusted(
  node: ConditionNode,
  scope: WhereScope,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment {
  const { reach } = ctx;
  ctx.reach = null;
  const fragment = compileNode(node, scope, dialect, ctx);
  ctx.reach = reach;
  return fragment;
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
  const parent = `${alias}.${dialect.quote('_parentUUID')}`;
  const correlation = childCorrelation(parent, scope, field, alias, dialect, ctx);
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
  const parent = `${wrapper}.${dialect.quote('_parentUUID')}`;
  const correlation = childCorrelation(parent, scope, field, wrapper, dialect, ctx);
  const type = rawFragment(`${wrapper}.${dialect.quote('_blockType')} = ?`, [split.block]);
  const pin = isNull(correlation.pin) ? type : joinFragments([correlation.pin, type], ' AND ');
  const typed: Correlation = { ...correlation, pin };
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
 * Ties a derived table's parent link to the scope's `UUID`, pinned to the locale when the field is scoped.
 */
function childCorrelation(
  parentLink: string,
  scope: WhereScope,
  field: FieldQueryMeta,
  alias: string,
  dialect: Dialect,
  ctx: CompileContext,
): Correlation {
  const pin = localePin(field, alias, dialect, ctx);
  return { inner: parentLink, outer: selfUUID(scope, dialect), pin, keyed: true };
}

/**
 * The `_localeCode` predicate of a locale-scoped derived table, `null` for an unscoped one.
 */
function localePin(
  field: FieldQueryMeta,
  alias: string,
  dialect: Dialect,
  ctx: CompileContext,
): SQLFragment | null {
  if (field.localeScoped !== true) return null;
  return rawFragment(`${alias}.${dialect.quote('_localeCode')} = ?`, [ctx.locale]);
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
 * An identity-only condition under a keyed correlation drops the tie for `<outer> IN (SELECT <inner> ...)`.
 * That set is computed once and searched by key, where the `EXISTS` would scan the outer table.
 */
function existsFragment(
  from: SQLFragment,
  correlation: Correlation,
  condition: ConditionNode | null,
  inner: WhereScope,
  dialect: Dialect,
  ctx: CompileContext,
  reach: ConditionNode | null = null,
): SQLFragment {
  const uncorrelated =
    correlation.keyed && !isNull(condition) && isIdentityOnly(condition, inner.fields);
  const parts: SQLFragment[] = [];
  if (!uncorrelated) parts.push(rawFragment(`${correlation.inner} = ${correlation.outer}`));
  if (!isNull(correlation.pin)) parts.push(correlation.pin);
  if (!isNull(condition)) {
    parts.push(compileNode(condition, inner, dialect, ctx));
    if (!isNull(reach)) {
      const scoped = compileTrusted(reach, inner, dialect, ctx);
      parts.push({ sql: `(${scoped.sql})`, params: scoped.params });
    }
  }
  const where = joinFragments(parts, ' AND ');
  const select = uncorrelated
    ? `${correlation.outer} IN (SELECT ${correlation.inner}`
    : 'EXISTS (SELECT 1';
  return {
    sql: `${select} FROM ${from.sql} WHERE ${where.sql})`,
    params: [...from.params, ...where.params],
  };
}

/**
 * Whether a `has` condition pins identities alone, which makes its subquery selective on its own.
 * Its leaves are un-negated `equalsTo`/`in` on a `UUID` or a `record` column, or `records` membership.
 * Any other leaf keeps the correlated `EXISTS`, so an ordered, limited read can stop at its first rows.
 */
function isIdentityOnly(node: ConditionNode, fields: Record<string, FieldQueryMeta>): boolean {
  if (node.kind === 'and' || node.kind === 'or') {
    return !isEmpty(node.nodes) && node.nodes.every((child) => isIdentityOnly(child, fields));
  }
  if (node.kind !== 'compare' || node.negated) return false;
  const field = fields[node.path[0]];
  if (node.op === 'equalsTo' || node.op === 'in') {
    return field.id === true || field.kind === 'record';
  }
  return (node.op === 'includes' || node.op === 'includesAny') && field.kind === 'records';
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
      return textMatch(column, `%${escapeLike(value as string)}%`, dialect);
    case 'startsWith':
      return textMatch(column, `${escapeLike(value as string)}%`, dialect);
    case 'endsWith':
      return textMatch(column, `%${escapeLike(value as string)}`, dialect);
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

/**
 * Compiles a case-insensitive text match, folding the column with `foldCase` only for a non-ASCII pattern.
 * An ASCII pattern folds ASCII letters alone, as the plain match does and the evaluator mirrors.
 */
function textMatch(column: string, pattern: string, dialect: Dialect): SQLFragment {
  const fold = !isASCII(pattern);
  return { sql: dialect.textMatch(column, fold), params: [fold ? foldCase(pattern) : pattern] };
}
