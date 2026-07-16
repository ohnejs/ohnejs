import type { ConditionNode } from '../../utils/index.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from './metadata.ts';

import { didYouMean, isNull, isString, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';
import { blockQueryMetadata, queryMetadata } from './metadata.ts';
import { allowedOperators, type QueryOperator } from './operators.ts';

/**
 * A single applicability failure a condition leaf carries, the shape both callers render.
 *
 * The fluent path throws it as an `ohneError` naming the field.
 * The wire path collapses the field kinds into one `invalidField`, so a URL cannot probe field existence.
 * The blocks kinds keep their own codes: the field already proved itself a blocks field.
 * Reads print block types on every response, so there is no oracle to protect.
 */
export interface ConditionProblem {
  /**
   * Whether the field is unknown or real but rejecting the operator.
   * The blocks kinds mark a `has` naming no type, or naming a type outside the field's allow set.
   */
  kind: 'unknownField' | 'inapplicable' | 'blockTypeRequired' | 'unknownBlockType';

  /**
   * The offending field, as addressed: a single segment, or the joined path of a multi-segment one.
   */
  field: string;

  /**
   * The operator the leaf applied, `has`/`empty` included (they read as operators here).
   */
  operator: QueryOperator;

  /**
   * The scope the field was looked up in, carrying the collection name and the candidate fields.
   */
  scope: CollectionQueryMeta;

  /**
   * The path from the condition root to the leaf, `has` boundaries included, for the wire dot path.
   */
  path: readonly string[];

  /**
   * The closest real field or allowed block type when the name is a near miss, for a `did you mean` hint.
   * Absent otherwise.
   */
  suggestion: string | undefined;

  /**
   * The block type the discriminator named; `unknownBlockType` only.
   */
  block?: string;
}

/**
 * Walks a parsed condition against a collection's metadata, returning the first applicability failure.
 *
 * Every leaf must address a real field and apply an operator that field admits.
 * A `has`'s nested condition re-scopes to the relation's target and is walked there in turn.
 * A blocks `has` scope must open with a bare `block` equality naming an allowed type.
 * The remainder walks that type's fields.
 * Its field name pushes onto the returned `path`, so the failure locates itself from the root.
 * A `where` path is a single segment in v1: an anchored or dotted path reads as an unknown field.
 * Returns `null` when every leaf is sound.
 */
export function checkCondition(
  node: ConditionNode,
  meta: CollectionQueryMeta,
  prefix: readonly string[] = [],
): ConditionProblem | null {
  if (node.kind === 'and' || node.kind === 'or') {
    for (const child of node.nodes) {
      const problem = checkCondition(child, meta, prefix);
      if (!isNull(problem)) return problem;
    }
    return null;
  }
  const operator: QueryOperator = node.kind === 'compare' ? node.op : node.kind;
  if (node.path.length !== 1) {
    const field = node.path.join('.');
    return {
      kind: 'unknownField',
      field,
      operator,
      scope: meta,
      path: [...prefix, field],
      suggestion: undefined,
    };
  }
  const name = node.path[0];
  const field = meta.fields[name];
  if (isUndefined(field)) {
    const suggestion = didYouMean(name, Object.keys(meta.fields));
    return {
      kind: 'unknownField',
      field: name,
      operator,
      scope: meta,
      path: [...prefix, name],
      suggestion,
    };
  }
  if (!allowedOperators(field).has(operator)) {
    return {
      kind: 'inapplicable',
      field: name,
      operator,
      scope: meta,
      path: [...prefix, name],
      suggestion: undefined,
    };
  }
  if (node.kind === 'has' && !isNull(node.condition)) {
    if (field.kind === 'blocks') return checkBlocksHas(node.condition, field, name, meta, prefix);
    return checkCondition(node.condition, targetScope(field, name, meta), [...prefix, name]);
  }
  return null;
}

/**
 * Applies the blocks two-step to a `has` scope: split off the discriminator, then walk the rest.
 * No discriminator is `blockTypeRequired`.
 * A type outside the entry's resolved allow set is `unknownBlockType`, the closest allowed type suggested.
 * The rest, when any, walks the named type's per-type scope.
 */
function checkBlocksHas(
  condition: ConditionNode,
  field: FieldQueryMeta,
  name: string,
  meta: CollectionQueryMeta,
  prefix: readonly string[],
): ConditionProblem | null {
  const split = splitBlockHas(condition);
  if (!split.ok) {
    return {
      kind: 'blockTypeRequired',
      field: name,
      operator: 'has',
      scope: meta,
      path: [...prefix, name],
      suggestion: undefined,
    };
  }
  const allow = field.allow as readonly string[];
  if (!allow.includes(split.block)) {
    return {
      kind: 'unknownBlockType',
      field: name,
      operator: 'has',
      scope: meta,
      path: [...prefix, name, 'block'],
      suggestion: didYouMean(split.block, allow),
      block: split.block,
    };
  }
  if (isNull(split.rest)) return null;
  return checkCondition(split.rest, blockScope(split.block, name, meta), [...prefix, name]);
}

/**
 * A blocks discriminator leaf: a bare, un-negated `block` equality naming a type.
 */
type Discriminator = Extract<ConditionNode, { kind: 'compare' }> & { value: string };

/**
 * Whether a node is the discriminator shape a blocks `has` scope opens with.
 */
function isDiscriminator(node: ConditionNode): node is Discriminator {
  return (
    node.kind === 'compare' &&
    !node.negated &&
    node.op === 'equalsTo' &&
    node.path.length === 1 &&
    node.path[0] === 'block' &&
    isString(node.value)
  );
}

/**
 * Splits a blocks `has` condition into its discriminator and the remaining condition.
 *
 * The discriminator is exactly one top-level, bare, un-negated `block` equality naming the type:
 * the root node itself, or a direct child of a root `and`.
 * `rest` is what remains.
 * It is `null` when the discriminator stood alone, one sibling bare, or several re-wrapped as `and`.
 * Returns `{ ok: false }` when nothing matches - a `has` scope that names no type.
 *
 * A `block` leaf surviving into `rest` (negated, listed, grouped, a second equality) is deliberate.
 * The per-type scope has no `block` field, so it falls out there as an unknown field.
 */
export function splitBlockHas(
  condition: ConditionNode,
): { ok: true; block: string; rest: ConditionNode | null } | { ok: false } {
  if (isDiscriminator(condition)) return { ok: true, block: condition.value, rest: null };
  if (condition.kind !== 'and') return { ok: false };
  const index = condition.nodes.findIndex(isDiscriminator);
  if (index === -1) return { ok: false };
  const block = (condition.nodes[index] as Discriminator).value;
  const rest = condition.nodes.filter((_, position) => position !== index);
  if (rest.length === 0) return { ok: true, block, rest: null };
  if (rest.length === 1) return { ok: true, block, rest: rest[0] as ConditionNode };
  return { ok: true, block, rest: { kind: 'and', nodes: rest } };
}

/**
 * Gates a parsed condition against a collection's metadata, the runtime twin of the type-level narrowing.
 *
 * Every leaf must address a real field and apply an operator that field admits.
 * An unknown field throws, with a `didYouMean` suggestion when one is close.
 * An inapplicable operator throws, naming the field and the operator.
 * A `has`'s nested condition re-scopes to the relation's target and is gated there in turn.
 * A blocks `has` scope must open with a bare `block` equality naming an allowed type.
 * A `where` path is a single segment in v1: an anchored or dotted path reads as an unknown field.
 * Untyped callers thus hit the same failures the typed surface prevents at compile time.
 */
export function validateCondition(node: ConditionNode, meta: CollectionQueryMeta): void {
  const problem = checkCondition(node, meta);
  if (isNull(problem)) return;
  if (problem.kind === 'unknownField') throw unknownFieldError(problem.field, problem.scope);
  if (problem.kind === 'blockTypeRequired') throw blockTypeRequiredError(problem);
  if (problem.kind === 'unknownBlockType') throw unknownBlockTypeError(problem);
  throw ohneError({
    title: `Operator \`${problem.operator}\` does not apply to \`${problem.field}\``,
    body: [
      `Field \`${problem.field}\` on collection \`${problem.scope.collection}\` does not support \`${problem.operator}\`.`,
    ],
  });
}

/**
 * The fluent failure for a blocks `has` scope that names no type.
 */
function blockTypeRequiredError(problem: ConditionProblem): ReturnType<typeof ohneError> {
  return ohneError({
    title: `A \`has\` on \`${problem.field}\` must name its block type`,
    body: [
      `Field \`${problem.field}\` on \`${problem.scope.collection}\` holds blocks, so a \`has\` scope opens with a bare \`block\` equality naming the type to match:`,
      '',
      `\`{ has: { block: 'Hero', ... } }\``,
    ],
  });
}

/**
 * The fluent failure for a discriminator naming a type outside the field's allow set.
 */
function unknownBlockTypeError(problem: ConditionProblem): ReturnType<typeof ohneError> {
  const allow = problem.scope.fields[problem.field]?.allow ?? [];
  const hint = isUndefined(problem.suggestion) ? '' : ` Did you mean \`${problem.suggestion}\`?`;
  const lead = `Field \`${problem.field}\` on \`${problem.scope.collection}\` does not allow block \`${problem.block}\`.${hint}`;
  return ohneError({
    title: `Unknown block type \`${problem.block}\``,
    body:
      allow.length === 1
        ? [`${lead} It holds only \`${allow[0]}\` blocks.`]
        : [lead, '', 'Allowed types:', ...allow.map((block) => `- \`${block}\``)],
  });
}

/**
 * The metadata a `has`'s nested condition is gated against, resolved by the field's kind.
 * A relation names its target collection; a child kind gets a synthetic scope over its subfields.
 */
export function targetScope(
  field: FieldQueryMeta,
  name: string,
  meta: CollectionQueryMeta,
): CollectionQueryMeta {
  if (field.kind === 'record' || field.kind === 'records') {
    return queryMetadata(field.target as string);
  }
  return {
    collection: `${meta.collection}.${name}`,
    table: field.table as string,
    fields: field.subfields as Record<string, FieldQueryMeta>,
  };
}

/**
 * The per-type scope a discriminated blocks `has` narrows to, resolved through `blockQueryMetadata`.
 * Shaped exactly as a child scope, so the shared walks re-scope through one shape.
 */
export function blockScope(
  block: string,
  name: string,
  meta: CollectionQueryMeta,
): CollectionQueryMeta {
  const blockMeta = blockQueryMetadata(block);
  return {
    collection: `${meta.collection}.${name}`,
    table: blockMeta.table,
    fields: blockMeta.fields,
  };
}

/**
 * Builds the unknown-field failure for `name`, suggesting the closest real field when one is near.
 * Shared by condition gating and by `select`/`orderBy`, so every unknown field reads the same way.
 */
export function unknownFieldError(
  name: string,
  meta: CollectionQueryMeta,
): ReturnType<typeof ohneError> {
  const suggestion = didYouMean(name, Object.keys(meta.fields));
  return ohneError({
    title: `Unknown field \`${name}\` on \`${meta.collection}\``,
    body: isUndefined(suggestion)
      ? [`Collection \`${meta.collection}\` has no field \`${name}\`.`]
      : [
          `Collection \`${meta.collection}\` has no field \`${name}\`. Did you mean \`${suggestion}\`?`,
        ],
  });
}
