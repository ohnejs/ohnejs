import type { LogicalType } from '../dialect.ts';
import type { SchemaClassification } from '../schema/snapshot.ts';
import type { DerivedOrigin, TableSchema } from '../schema/table-schema.ts';
import type {
  ColumnAddress,
  DiscardMigration,
  MigrationTransform,
  MoveMigration,
  RenameMigration,
  SwitchAttributes,
  TableAddress,
} from './define-migration.ts';
import type { MigrationMeta } from './use-migrations.ts';

import { isNull, isObject, isUndefined, last } from '../../../utils/index.ts';
import { ohneError } from '../../error/ohne-error.ts';
import {
  companionTableName,
  derivedRootName,
  derivedTableName,
  ownerTableName,
  type DerivedOwner,
} from '../naming/table-names.ts';
import { RESERVED_COLLECTIONS } from '../naming/validate-names.ts';

/**
 * The logical subtree an address covers: an owner and the field path below it.
 * Exactly one of `collection` and `block` names the owner.
 * An empty path covers the whole owner, derived tables included.
 */
export interface LogicalSubtree {
  /**
   * The owning collection's logical name; absent when a block owns the subtree.
   */
  collection?: string;

  /**
   * The owning block's name; absent when a collection owns the subtree.
   */
  block?: string;

  /**
   * The field path below the owner; empty for the owner itself.
   */
  path: readonly string[];
}

/**
 * One table a migration's `from` consumes, computed purely from the address, no live schema needed.
 * An ambiguous logical `from` lists both of its readings; over-approximation is safe for satisfaction.
 */
export interface ConsumedAddress {
  /**
   * The physical table name.
   */
  table: string;

  /**
   * The column name; absent when the whole table is consumed.
   */
  column?: string;

  /**
   * The logical subtree a table-grain logical `from` consumes, its derived family included.
   * A compound enumerates its family only at run time, so satisfaction matches on this instead:
   * a logical `to` under the subtree counts as consumed even where no physical name can line up.
   */
  subtree?: LogicalSubtree;
}

/**
 * One member of a compound rename: a physical pair plus the claim origin the rename installs.
 */
export interface RenameMember {
  /**
   * The physical table as it exists live.
   */
  from: string;

  /**
   * The physical table name after the rename.
   */
  to: string;

  /**
   * The derivation origin the renamed table's claim takes; absent on a collection main table.
   */
  origin?: DerivedOrigin;

  /**
   * The collection whose translations the renamed companion stores; absent everywhere else.
   * The claim's `companion` marker follows the rename through it.
   */
  companion?: string;

  /**
   * The block whose per-type table the renamed member becomes; absent everywhere else.
   * The claim's `block` marker follows the rename through it.
   */
  block?: string;
}

/**
 * The one attribute a switch migration flips.
 */
export type SwitchAttribute = keyof SwitchAttributes;

/**
 * A switch migration lowered against the live state: the flipped attribute and where it lives.
 * `table` is the column's live home - main table or companion - or the main reading when absent.
 * `column` is absent when the field is live as a locale-scoped derived table.
 * The owner - `collection` or `block` - and `segments` carry the logical spelling.
 * The executor resolves placements through them.
 */
export interface LoweredSwitch {
  kind: 'switch';
  attribute: SwitchAttribute;
  from: boolean;
  to?: boolean;
  table: string;
  column?: string;
  collection?: string;
  block?: string;
  segments?: readonly string[];
  type?: LogicalType;
  transform?: MigrationTransform;
}

/**
 * A migration lowered to physical form: one of the single ops, a compound's member list, or a switch.
 * A block-level rename carries `blockType`: the `_blockType` value every live wrapper rewrites.
 */
export type LoweredMigration =
  | {
      kind: 'move';
      from: ColumnAddress;
      to: ColumnAddress;
      toSubtree?: LogicalSubtree;
      transform?: MigrationTransform;
    }
  | { kind: 'rename'; from: TableAddress; to: TableAddress }
  | { kind: 'discardColumn'; from: ColumnAddress }
  | { kind: 'discardTable'; from: TableAddress }
  | {
      kind: 'compoundRename';
      members: readonly RenameMember[];
      to: LogicalSubtree;
      blockType?: { from: string; to: string };
    }
  | { kind: 'compoundDiscard'; tables: readonly string[] }
  | LoweredSwitch;

/**
 * The live and desired state a logical address lowers against, just in time in the executor loop.
 */
export interface ResolveState {
  /**
   * The live table names, tracked through the run's own changes.
   */
  names: ReadonlySet<string>;

  /**
   * The claim record, tracked through the run's own changes.
   */
  claimed: SchemaClassification;

  /**
   * The tables the running code wants live.
   */
  desired: readonly TableSchema[];

  /**
   * Whether the snapshot recorded derivation ownership on its claims.
   * Without it, a rename verifies its family through the `to` tree and a table discard refuses.
   */
  ownership: boolean;

  /**
   * Describes one live table, logical types restored.
   */
  describe(table: string): Promise<TableSchema>;
}

/**
 * A logical address in its loosest runtime shape, the union every form's address satisfies.
 */
interface LogicalAddress {
  collection?: string;
  block?: string;
  field?: string;
  type?: LogicalType;
}

/**
 * A physical address in its loosest runtime shape.
 */
type PhysicalAddress = ColumnAddress | TableAddress;

/**
 * An address of any form and either spelling, as the resolver receives it.
 */
type AnyAddress = MoveMigration['from'] | RenameMigration['from'] | DiscardMigration['from'];

/**
 * Whether an address is spelled logically: it roots at a collection or a block.
 */
function isLogicalAddress(address: object): boolean {
  return 'collection' in address || 'block' in address;
}

/**
 * The one set owner as keys to spread into a subtree or origin, never an `undefined` key beside it.
 */
function ownerKeys(owner: DerivedOwner): DerivedOwner {
  return isUndefined(owner.collection) ? { block: owner.block } : { collection: owner.collection };
}

/**
 * Whether two owners name the same family root: the same kind and the same name.
 */
function sameOwner(a: DerivedOwner, b: DerivedOwner): boolean {
  return a.collection === b.collection && a.block === b.block;
}

/**
 * Whether a derived origin sits under the given owner.
 */
function ownedBy(origin: DerivedOrigin, owner: DerivedOwner): boolean {
  return isUndefined(owner.collection)
    ? origin.block === owner.block
    : origin.collection === owner.collection;
}

/**
 * The physical readings of one address: the tables it may name, purely from the address itself.
 * An ambiguous logical address lists both readings; over-approximation is safe for both callers.
 * A collection and a top-level field list the companion reading too: a translatable column lives there.
 * A block owner never has one, so its readings stop at the column and the table.
 */
function readingsOf(meta: MigrationMeta, address: AnyAddress): ConsumedAddress[] {
  if (!isLogicalAddress(address)) {
    const physical = address as PhysicalAddress;
    return 'column' in physical
      ? [{ table: physical.table, column: physical.column }]
      : [{ table: physical.table }];
  }
  const logical = address as LogicalAddress;
  const owner = logicalOwner(meta, logical);
  if (isUndefined(logical.field)) {
    const readings: ConsumedAddress[] = [
      { table: ownerTableName(owner), subtree: { ...ownerKeys(owner), path: [] } },
    ];
    if (!isUndefined(owner.collection)) {
      readings.push({ table: companionTableName(owner.collection) });
    }
    return readings;
  }
  const segments = fieldSegments(meta, logical.field);
  const column = columnReading(owner, segments);
  const readings: ConsumedAddress[] = [
    { table: column.table, column: column.column },
    { table: tableReading(owner, segments), subtree: { ...ownerKeys(owner), path: segments } },
  ];
  if (segments.length === 1 && !isUndefined(owner.collection)) {
    readings.push({ table: companionTableName(owner.collection), column: column.column });
  }
  return readings;
}

/**
 * The migration's `from` address, shape-checked: a missing or non-object `from` refuses by name.
 */
function fromAddress(meta: MigrationMeta): AnyAddress {
  const from = (meta.migration as { from?: unknown }).from;
  if (isObject(from)) return from as unknown as AnyAddress;
  throw ohneError({
    title: `Migration \`${meta.name}\` has no \`from\``,
    body: [
      '`from` names what the migration reads: a `collection` and `field`, or a `table` and `column`.',
    ],
    path: meta.file,
  });
}

/**
 * The migration's `to` address, shape-checked: `null` marks a discard; anything else is an address.
 */
function toAddress(meta: MigrationMeta): AnyAddress | null {
  const to = (meta.migration as { to?: unknown }).to;
  if (isNull(to)) return null;
  if (isObject(to)) return to as unknown as AnyAddress;
  throw ohneError({
    title: `Migration \`${meta.name}\` has no \`to\``,
    body: ['A move or rename sets `to` to the new address; a discard sets `to: null` on purpose.'],
    path: meta.file,
  });
}

/**
 * The tables a migration's `from` consumes, for `to`-satisfaction of the migrations before it.
 * Pure over the address: physical names never need the live schema, so chains skip end to end.
 */
export function consumedByMigration(meta: MigrationMeta): ConsumedAddress[] {
  return readingsOf(meta, fromAddress(meta));
}

/**
 * The physical tables a migration may touch, for the sync's constraint bracket.
 * Pure over the addresses; an ambiguous logical address contributes both of its readings.
 * A switch flips in place, so its `from` readings already cover everything it touches.
 */
export function touchedByMigration(meta: MigrationMeta): string[] {
  const from = fromAddress(meta);
  const tables = readingsOf(meta, from).map((consumed) => consumed.table);
  if (switchKeysOf(from).length > 0) return tables;
  const to = toAddress(meta);
  if (isNull(to)) return tables;
  return [...tables, ...readingsOf(meta, to).map((consumed) => consumed.table)];
}

/**
 * The attribute keys of the four switches, in one place for detection and validation.
 */
const SWITCH_KEYS = ['nullable', 'unique', 'uniquePerLocale', 'translatable'] as const;

/**
 * The switch keys an address carries; a non-empty result marks the migration as a switch.
 */
function switchKeysOf(address: object): SwitchAttribute[] {
  return SWITCH_KEYS.filter((key) => !isUndefined((address as Record<string, unknown>)[key]));
}

/**
 * Lowers one migration to physical form against the live and desired state, just in time.
 *
 * Physical addresses pass through; logical ones resolve through the naming builders.
 * A logical pair reads as a move over a live column, as a rename over a live derived table.
 * `transform` or a `type` pin selects the column reading; both readings live at once refuses.
 * With no live evidence the `to` side decides, so fresh databases skip chains end to end.
 * A collection-level rename or discard lowers to its family of member tables, claims-enumerated.
 * A pre-ownership snapshot bootstraps a rename's family from the `to` tree.
 * Table-grain discards refuse there, since nothing records what they cover.
 * A switch key on `from` marks the fourth form and lowers first, before any address pairing.
 */
export async function lowerMigration(
  state: ResolveState,
  meta: MigrationMeta,
): Promise<LoweredMigration> {
  const { migration } = meta;
  const from = fromAddress(meta);
  const rawTo = (migration as { to?: unknown }).to;
  if (switchKeysOf(from).length > 0 || attributesOnly(rawTo)) {
    return lowerSwitch(
      state,
      meta,
      from,
      rawTo,
      'transform' in migration
        ? (migration.transform as MigrationTransform | undefined)
        : undefined,
    );
  }
  const to = toAddress(meta);
  const fromLogical = isLogicalAddress(from);
  const transform =
    'transform' in migration ? (migration.transform as MigrationTransform | undefined) : undefined;
  if (isNull(to)) {
    if (!isUndefined(transform)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` pairs a transform with a discard`,
        body: [
          'A transform rides a move; a discard only drops.',
          'Drop the transform, or make the migration a move.',
        ],
        path: meta.file,
      });
    }
    if (!fromLogical) {
      const physical = from as PhysicalAddress;
      assertPurelyPhysical(meta, physical);
      return 'column' in physical
        ? { kind: 'discardColumn', from: physical }
        : { kind: 'discardTable', from: physical };
    }
    assertPurelyLogical(meta, from as LogicalAddress);
    return lowerDiscard(state, meta, from as LogicalAddress);
  }
  const toLogical = isLogicalAddress(to);
  if (fromLogical !== toLogical) {
    throw ohneError({
      title: `Migration \`${meta.name}\` mixes a logical and a physical address`,
      body: [
        'A logical `collection` or `block` address pairs with a logical one; a physical `table` with a physical one.',
        'Give `from` and `to` the same form.',
      ],
      path: meta.file,
    });
  }
  if (!fromLogical || !toLogical) {
    return lowerPhysicalPair(meta, from as PhysicalAddress, to as PhysicalAddress, transform);
  }
  assertPurelyLogical(meta, from as LogicalAddress);
  assertPurelyLogical(meta, to as LogicalAddress);
  return lowerLogicalPair(state, meta, from as LogicalAddress, to as LogicalAddress, transform);
}

/**
 * Normalizes a physical pair into a move or a rename.
 * A `ColumnAddress` satisfies `TableAddress` structurally, so a mixed pair typechecks; refuse it here.
 */
function lowerPhysicalPair(
  meta: MigrationMeta,
  from: PhysicalAddress,
  to: PhysicalAddress,
  transform: MigrationTransform | undefined,
): LoweredMigration {
  assertPurelyPhysical(meta, from);
  assertPurelyPhysical(meta, to);
  const fromColumn = 'column' in from;
  const toColumn = 'column' in to;
  if (fromColumn !== toColumn) {
    throw ohneError({
      title: `Migration \`${meta.name}\` mixes a column and a table address`,
      body: [
        'A move addresses two columns; a rename addresses two tables.',
        'Give `from` and `to` the same shape.',
      ],
      path: meta.file,
    });
  }
  if (fromColumn) {
    return { kind: 'move', from, to: to as ColumnAddress, transform };
  }
  if (!isUndefined(transform)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` transforms without a column`,
      body: [
        'A transform rides a move, and a move addresses two columns.',
        'Address the columns, or drop the transform.',
      ],
      path: meta.file,
    });
  }
  if (from.table === to.table) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames \`${from.table}\` onto itself`,
      body: ['Point `to` at the new table name, or delete the migration.'],
      path: meta.file,
    });
  }
  return { kind: 'rename', from, to: to as TableAddress };
}

/**
 * Refuses a physical address carrying logical keys, a stray `type`, or a column missing its type.
 * The `ohne_` namespace refuses too: those tables carry framework state, never user data.
 * A mistyped address must never silently read as something else.
 */
function assertPurelyPhysical(meta: MigrationMeta, address: PhysicalAddress): void {
  if (address.table.startsWith('ohne_')) {
    throw ohneError({
      title: `Migration \`${meta.name}\` targets ohne's internal \`${address.table}\``,
      body: [
        "Tables under the `ohne_` prefix carry the framework's own state, never user data.",
        'Fix the migration address.',
      ],
      path: meta.file,
    });
  }
  if ('field' in address) {
    throw ohneError({
      title: `Migration \`${meta.name}\` mixes address spellings`,
      body: [
        'An address is logical (`collection`, `field`) or physical (`table`, `column`), never both.',
        'Drop one spelling.',
      ],
      path: meta.file,
    });
  }
  if ('column' in address) {
    if (!isUndefined(address.type)) return;
    throw ohneError({
      title: `Migration \`${meta.name}\` addresses a column without its \`type\``,
      body: [
        'A physical column address pins the `type` it expects live.',
        'Set it, or use the logical `collection` and `field` spelling, which resolves types for you.',
      ],
      path: meta.file,
    });
  }
  if ('type' in address && !isUndefined((address as { type?: unknown }).type)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` pins a \`type\` without a column`,
      body: ['A table address names no column to type.', 'Name the `column`, or drop `type`.'],
      path: meta.file,
    });
  }
}

/**
 * Whether a `to` is a bare attribute-state object: no address keys, no `null`, just switch states.
 */
function attributesOnly(to: unknown): boolean {
  if (!isObject(to)) return false;
  return !isLogicalAddress(to) && !('table' in to);
}

/**
 * Lowers a switch migration: validates the one flipped attribute and resolves the field's live home.
 *
 * `from` carries exactly one switch key, asserting the live state; `to` at most the same key flipped.
 * `translatable` is logical-only - a raw table has no translatable concept.
 * It is top-level only too: a subfield's composite is per-locale as a whole, so a dot path refuses.
 * The other switches flip a column, so a field live as a derived table refuses them.
 * A field live as a table lowers column-less: the executor scopes the whole table by locale.
 * An absent field lowers onto the main reading; the executor's skip logic checks the desired side.
 */
async function lowerSwitch(
  state: ResolveState,
  meta: MigrationMeta,
  from: AnyAddress,
  rawTo: unknown,
  transform: MigrationTransform | undefined,
): Promise<LoweredMigration> {
  const keys = switchKeysOf(from);
  if (keys.length === 0) {
    throw ohneError({
      title: `Migration \`${meta.name}\` switches without a \`from\` state`,
      body: [
        'A switch migration asserts the live attribute state on `from`, so drift refuses instead of guessing.',
        'Set the flipped attribute on `from`.',
      ],
      path: meta.file,
    });
  }
  if (keys.length > 1) {
    throw ohneError({
      title: `Migration \`${meta.name}\` flips ${keys.length} attributes at once`,
      body: [
        'One migration flips one attribute; files chain for more.',
        `Split ${keys.map((key) => `\`${key}\``).join(', ')} into one migration each.`,
      ],
      path: meta.file,
    });
  }
  const attribute = keys[0] as SwitchAttribute;
  const fromValue = (from as unknown as Record<string, unknown>)[attribute];
  if (typeof fromValue !== 'boolean') {
    throw ohneError({
      title: `Migration \`${meta.name}\` asserts a non-boolean \`${attribute}\``,
      body: ['A switch attribute is a plain boolean state.', `Set \`${attribute}\` to one.`],
      path: meta.file,
    });
  }
  const toValue = resolveSwitchTo(meta, attribute, fromValue, rawTo);

  if (!isLogicalAddress(from)) {
    const physical = from as PhysicalAddress;
    if (attribute === 'translatable') {
      throw ohneError({
        title: `Migration \`${meta.name}\` switches \`translatable\` on a physical address`,
        body: [
          'A raw table has no translatable concept; the flip needs the logical spelling.',
          'Address the `collection` and `field`.',
        ],
        path: meta.file,
      });
    }
    assertPurelyPhysical(meta, physical);
    if (!('column' in physical)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` switches without a column`,
        body: [
          `A \`${attribute}\` switch flips one column's state, and the address names none.`,
          'Name the `column`.',
        ],
        path: meta.file,
      });
    }
    return {
      kind: 'switch',
      attribute,
      from: fromValue,
      to: toValue,
      table: physical.table,
      column: physical.column,
      type: physical.type,
      transform,
    };
  }

  assertPurelyLogical(meta, from as LogicalAddress);
  const logical = from as LogicalAddress;
  const owner = logicalOwner(meta, logical);
  const root = derivedRootName(owner);
  if (isUndefined(logical.field)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` switches without a field`,
      body: [
        `A switch flips one field's attribute, and a ${ownerNoun(owner)} has none of its own.`,
        'Name the `field`.',
      ],
      path: meta.file,
    });
  }
  const segments = fieldSegments(meta, logical.field);
  if (
    !isUndefined(owner.block) &&
    (attribute === 'translatable' || attribute === 'uniquePerLocale')
  ) {
    throw ohneError({
      title: `Migration \`${meta.name}\` switches \`${attribute}\` on a block field`,
      body: [
        `\`${root}.${logical.field}\` lives on a per-type block table, and blocks store no locale dimension.`,
        'Address a collection field.',
      ],
      path: meta.file,
    });
  }
  if (attribute === 'translatable' && segments.length > 1) {
    throw ohneError({
      title: `Migration \`${meta.name}\` switches \`translatable\` on a subfield`,
      body: [
        `\`${root}.${logical.field}\` sits below a composite, and a composite is per-locale as a whole.`,
        'Switch the top-level composite instead.',
      ],
      path: meta.file,
    });
  }
  const home = await liveColumnHome(state, owner, segments);
  const tableRead = tableReading(owner, segments);
  const tableLive = state.names.has(tableRead);
  if (!isUndefined(home) && tableLive) {
    throw ohneError({
      title: `Migration \`${meta.name}\` matches two readings`,
      body: [
        `\`${root}.${logical.field}\` is a live column on \`${home.table}\` and the live table \`${tableRead}\` at once.`,
        'Use the physical `table` and `column` spelling to pick one.',
      ],
      path: meta.file,
    });
  }
  if (tableLive) {
    if (attribute !== 'translatable') {
      throw ohneError({
        title: `Migration \`${meta.name}\` switches \`${attribute}\` on a table`,
        body: [
          `A \`${attribute}\` switch flips one column's state, and \`${root}.${logical.field}\` is live as the table \`${tableRead}\`.`,
          'Fix the address.',
        ],
        path: meta.file,
      });
    }
    return {
      kind: 'switch',
      attribute,
      from: fromValue,
      to: toValue,
      table: tableRead,
      ...ownerKeys(owner),
      segments,
      type: logical.type,
      transform,
    };
  }
  const column = home ?? columnReading(owner, segments);
  return {
    kind: 'switch',
    attribute,
    from: fromValue,
    to: toValue,
    table: column.table,
    column: column.column,
    ...ownerKeys(owner),
    segments,
    type: logical.type,
    transform,
  };
}

/**
 * Resolves a switch's `to` into the target state, or nothing when the desired schema supplies it.
 * A `to` carrying an address, another attribute, or the unchanged state refuses by name.
 */
function resolveSwitchTo(
  meta: MigrationMeta,
  attribute: SwitchAttribute,
  fromValue: boolean,
  rawTo: unknown,
): boolean | undefined {
  if (isUndefined(rawTo)) return undefined;
  if (!attributesOnly(rawTo)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` pairs a switch with an address`,
      body: [
        "A switch's `to` carries only the target attribute state, or is omitted for the desired schema's.",
        'Drop the address from `to`.',
      ],
      path: meta.file,
    });
  }
  const toKeys = switchKeysOf(rawTo as object);
  const toValue = (rawTo as Record<string, unknown>)[attribute];
  if (toKeys.length !== 1 || toKeys[0] !== attribute || typeof toValue !== 'boolean') {
    throw ohneError({
      title: `Migration \`${meta.name}\` switches \`${attribute}\` onto something else`,
      body: [
        '`to` states the one flipped attribute, matching `from`.',
        `Set \`${attribute}\` alone on \`to\`, or omit \`to\` for the desired schema's state.`,
      ],
      path: meta.file,
    });
  }
  if (toValue === fromValue) {
    throw ohneError({
      title: `Migration \`${meta.name}\` switches \`${attribute}\` onto itself`,
      body: ['Point `to` at the other state, or delete the migration.'],
      path: meta.file,
    });
  }
  return toValue;
}

/**
 * Lowers a logical pair: resolves the reading, then builds the move or the rename compound.
 * A field pair may cross owners as a move; a rename stays within its owner, and never crosses kinds.
 * An owner-level block pair is the mechanical block rename, `_blockType` rewrite included.
 */
async function lowerLogicalPair(
  state: ResolveState,
  meta: MigrationMeta,
  from: LogicalAddress,
  to: LogicalAddress,
  transform: MigrationTransform | undefined,
): Promise<LoweredMigration> {
  const fromOwner = logicalOwner(meta, from);
  const toOwner = logicalOwner(meta, to);
  const fromRoot = derivedRootName(fromOwner);
  const toRoot = derivedRootName(toOwner);

  if (isUndefined(from.field) !== isUndefined(to.field)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` pairs a ${ownerNoun(fromOwner)} with a field`,
      body: [
        'A collection or block renames onto its own kind; a field moves or renames onto a field.',
        'Give `from` and `to` the same shape.',
      ],
      path: meta.file,
    });
  }

  if (isUndefined(from.field) || isUndefined(to.field)) {
    if (!isUndefined(transform)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` transforms without a column`,
        body: [
          'A transform rides a move, and a move needs `field` naming the column.',
          'Name the field, or drop the transform.',
        ],
        path: meta.file,
      });
    }
    if (!isUndefined(from.type) || !isUndefined(to.type)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` pins a \`type\` without a field`,
        body: [
          `A ${ownerNoun(fromOwner)} rename names no column.`,
          'Name the field, or drop `type`.',
        ],
        path: meta.file,
      });
    }
    if (isUndefined(fromOwner.collection) !== isUndefined(toOwner.collection)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` renames a ${ownerNoun(fromOwner)} onto a ${ownerNoun(toOwner)}`,
        body: [
          'A collection renames onto a collection; a block onto a block.',
          'Fix the addresses.',
        ],
        path: meta.file,
      });
    }
    if (sameOwner(fromOwner, toOwner)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` renames \`${fromOwner.collection ?? fromOwner.block}\` onto itself`,
        body: [`Point \`to\` at the new ${ownerNoun(fromOwner)} name, or delete the migration.`],
        path: meta.file,
      });
    }
    return lowerRenameCompound(state, meta, fromOwner, [], toOwner, []);
  }

  const fromSegments = fieldSegments(meta, from.field);
  const toSegments = fieldSegments(meta, to.field);
  const { reading, fromLive } = await resolveReading(
    state,
    meta,
    fromOwner,
    fromSegments,
    toOwner,
    toSegments,
    from.type,
    to.type,
    transform,
  );

  if (reading === 'column') {
    return {
      kind: 'move',
      from: await lowerColumn(state, meta, from, fromOwner, fromSegments, 'from', fromLive),
      to: await lowerColumn(state, meta, to, toOwner, toSegments, 'to', fromLive),
      toSubtree: { ...ownerKeys(toOwner), path: toSegments },
      transform,
    };
  }

  if (!sameOwner(fromOwner, toOwner)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames a field across ${ownerNoun(fromOwner)}s`,
      body: [
        `\`${fromRoot}.${from.field}\` cannot become \`${toRoot}.${to.field}\`: a rename stays within its ${ownerNoun(fromOwner)}.`,
        `Rename the ${ownerNoun(fromOwner)} separately, or move the data instead.`,
      ],
      path: meta.file,
    });
  }
  if (
    fromSegments.length !== toSegments.length ||
    fromSegments.slice(0, -1).some((segment, index) => segment !== toSegments[index])
  ) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames across the field tree`,
      body: [
        `\`${from.field}\` cannot become \`${to.field}\`: a rename changes the last path segment only.`,
        'Rename the parent composite separately.',
      ],
      path: meta.file,
    });
  }
  if (from.field === to.field) {
    throw ohneError({
      title: `Migration \`${meta.name}\` renames \`${fromRoot}.${from.field}\` onto itself`,
      body: ['Point `to` at the new field name, or delete the migration.'],
      path: meta.file,
    });
  }
  return lowerRenameCompound(state, meta, fromOwner, fromSegments, toOwner, toSegments);
}

/**
 * Resolves whether a logical pair addresses a column or a derived table.
 *
 * `transform` or a `type` pin selects the column reading outright.
 * A pin aimed at a field that lives only as a table refuses and names itself as the cause.
 * Otherwise the live `from` decides: a live column reads as a move, a live derived table as a rename.
 * Both live at once refuses, naming the escape hatches.
 * With no live evidence the `to` side decides the reading, desired first, then live.
 * The desired schema never holds both readings: one field materializes as one storage shape.
 *
 * `fromLive` reports whether the `from` column is live, so the caller knows the move will run:
 * an absent `from` only ever skips or refuses, both blind to the lowered types.
 */
async function resolveReading(
  state: ResolveState,
  meta: MigrationMeta,
  fromOwner: DerivedOwner,
  fromSegments: readonly string[],
  toOwner: DerivedOwner,
  toSegments: readonly string[],
  fromType: LogicalType | undefined,
  toType: LogicalType | undefined,
  transform: MigrationTransform | undefined,
): Promise<{ reading: 'column' | 'table'; fromLive: boolean }> {
  const fromRoot = derivedRootName(fromOwner);
  const fromHome = await liveColumnHome(state, fromOwner, fromSegments);
  const fromTable = tableReading(fromOwner, fromSegments);
  const columnLive = !isUndefined(fromHome);
  const tableLive = state.names.has(fromTable);
  if (!isUndefined(transform) || !isUndefined(fromType) || !isUndefined(toType)) {
    if (tableLive && !columnLive) {
      throw ohneError({
        title: `Migration \`${meta.name}\` addresses the table \`${fromTable}\` as a column`,
        body: [
          `\`${fromRoot}.${fromSegments.join('.')}\` is live as the table \`${fromTable}\`, and a transform or \`type\` pin selects the column reading.`,
          'Drop it to rename the table, or address the column you meant.',
        ],
        path: meta.file,
      });
    }
    return { reading: 'column', fromLive: columnLive };
  }
  if (columnLive && tableLive) {
    throw ohneError({
      title: `Migration \`${meta.name}\` matches two readings`,
      body: [
        `\`${fromRoot}.${fromSegments.join('.')}\` is a live column on \`${fromHome.table}\` and the live table \`${fromTable}\` at once.`,
        'Pin `type` to address the column, or use the physical `table` spelling for the table.',
      ],
      path: meta.file,
    });
  }
  if (columnLive) return { reading: 'column', fromLive: true };
  if (tableLive) return { reading: 'table', fromLive: false };

  const toTable = tableReading(toOwner, toSegments);
  if (!isUndefined(desiredColumnHome(state, toOwner, toSegments))) {
    return { reading: 'column', fromLive: false };
  }
  if (state.desired.some((table) => table.name === toTable)) {
    return { reading: 'table', fromLive: false };
  }
  const toHome = await liveColumnHome(state, toOwner, toSegments);
  const toTableLive = state.names.has(toTable);
  if (toTableLive && isUndefined(toHome)) return { reading: 'table', fromLive: false };
  return { reading: 'column', fromLive: false };
}

/**
 * Lowers one side of a move to its physical column address, resolving the table and type it asserts.
 *
 * The table is the column's home: the main-path table, or the companion when the column lives
 * (or is desired) there - a translatable field's column moves with its flag, and so must the address.
 * An explicit `type` wins and stays the live-drift assertion.
 * A `from` falls back to the claim record, then the live column, then a placeholder.
 * The executor never reads the placeholder: an absent `from` skips before any type is read.
 * A `to` falls back to the desired schema, then the claim record, then the live column.
 * A `to` that exists nowhere while the `from` is live demands an explicit `type` to be created as.
 * With the `from` absent the move only skips or refuses, both blind to the types.
 * The `to` then takes the placeholder too, so chains skip end to end unpinned.
 */
async function lowerColumn(
  state: ResolveState,
  meta: MigrationMeta,
  address: LogicalAddress,
  owner: DerivedOwner,
  segments: readonly string[],
  role: 'from' | 'to',
  fromLive: boolean,
): Promise<ColumnAddress> {
  const reading = columnReading(owner, segments);
  const column = reading.column;
  const desiredHome = role === 'to' ? desiredColumnHome(state, owner, segments) : undefined;
  const liveHome = await liveColumnHome(state, owner, segments);
  const table = desiredHome?.table ?? liveHome?.table ?? reading.table;
  if (!isUndefined(address.type)) return { table, column, type: address.type };
  if (!isUndefined(desiredHome)) return { table, column, type: desiredHome.type };
  const claimed = state.claimed[table]?.columns[column];
  if (!isUndefined(claimed)) return { table, column, type: claimed };
  if (state.names.has(table)) {
    const live = await state.describe(table);
    const found = live.columns.find((item) => item.name === column);
    if (!isUndefined(found)) return { table, column, type: found.type };
  }
  if (role === 'from' || !fromLive) return { table, column, type: 'text' };
  throw ohneError({
    title: `Migration \`${meta.name}\` needs a \`type\` on its \`to\``,
    body: [
      `\`${derivedRootName(owner)}.${segments.join('.')}\` exists nowhere yet - neither live nor in the desired schema - so nothing supplies its type.`,
      'Set `type` on the `to` address, so the engine knows what to create the column as.',
    ],
    path: meta.file,
  });
}

/**
 * The live home of a field's column: the main-path table, or the collection's claimed companion.
 * A translatable field's column lives on the companion, reachable for top-level fields only.
 * A block owner has no companion, so its columns live on the main path alone.
 * Returns nothing when the column is live on neither.
 */
async function liveColumnHome(
  state: ResolveState,
  owner: DerivedOwner,
  segments: readonly string[],
): Promise<{ table: string; column: string } | undefined> {
  const { table, column } = columnReading(owner, segments);
  if (await liveColumn(state, table, column)) return { table, column };
  if (isUndefined(owner.collection) || segments.length !== 1) return undefined;
  const companion = companionTableName(owner.collection);
  if (state.claimed[companion]?.companion !== owner.collection) return undefined;
  if (await liveColumn(state, companion, column)) return { table: companion, column };
  return undefined;
}

/**
 * The desired home of a field's column: the main-path table, or the collection's desired companion.
 * Supplies the type beside the table, so a lowered `to` creates the column as the schema wants it.
 * A block owner has no companion, so its columns land on the main path alone.
 * Returns nothing when the desired schema holds the column on neither.
 */
function desiredColumnHome(
  state: ResolveState,
  owner: DerivedOwner,
  segments: readonly string[],
): { table: string; column: string; type: LogicalType } | undefined {
  const { table, column } = columnReading(owner, segments);
  const wanted = state.desired
    .find((schema) => schema.name === table)
    ?.columns.find((item) => item.name === column);
  if (!isUndefined(wanted)) return { table, column, type: wanted.type };
  if (isUndefined(owner.collection) || segments.length !== 1) return undefined;
  const companionName = companionTableName(owner.collection);
  const held = state.desired
    .find((schema) => schema.name === companionName && schema.companion === owner.collection)
    ?.columns.find((item) => item.name === column);
  if (!isUndefined(held)) return { table: companionName, column, type: held.type };
  return undefined;
}

/**
 * Lowers a logical rename to its compound: the primary table plus every family member.
 *
 * With ownership the family enumerates from the claims whose origin sits under the `from` path.
 * A collection rename carries the claimed companion along; a field path and a block never own one.
 * Each member's new name and claim origin recompute from the `to` side, fresh truncation included.
 * Without ownership the family bootstraps from the `to` tree in the desired schema.
 * Each implied member must then be live while the primary is, or the fields changed with the rename.
 * That combination refuses, never silently partial.
 * A field-path primary takes its origin from the claims, or from the `to` tree when the snapshot lacks it.
 * A derived table must never rename origin-less, or later correlation misreads it.
 * Members order primary first, then by live name, so runs are deterministic.
 * A block-level rename attaches the `_blockType` rewrite every live wrapper applies after the members.
 */
function lowerRenameCompound(
  state: ResolveState,
  meta: MigrationMeta,
  fromOwner: DerivedOwner,
  fromPath: readonly string[],
  toOwner: DerivedOwner,
  toPath: readonly string[],
): LoweredMigration {
  const fromPrimary =
    fromPath.length === 0
      ? ownerTableName(fromOwner)
      : derivedTableName(derivedRootName(fromOwner), fromPath[0] as string, ...fromPath.slice(1));
  const toPrimary =
    toPath.length === 0
      ? ownerTableName(toOwner)
      : derivedTableName(derivedRootName(toOwner), toPath[0] as string, ...toPath.slice(1));
  // A field-path primary reads its origin from the claims; a pre-ownership snapshot has none
  // there, so the desired `to` tree supplies it - the claim must never rename origin-less.
  const claimedOrigin = fromPath.length === 0 ? undefined : state.claimed[fromPrimary]?.derived;
  const primaryOrigin = isUndefined(claimedOrigin)
    ? state.desired.find((table) => table.name === toPrimary)?.derived
    : {
        ...claimedOrigin,
        ...ownerKeys(toOwner),
        path: renamedPath(claimedOrigin.path, fromPath, toPath),
      };
  if (
    fromPath.length > 0 &&
    isUndefined(primaryOrigin) &&
    !state.ownership &&
    state.names.has(fromPrimary)
  ) {
    throw ohneError({
      title: `Migration \`${meta.name}\` cannot verify the rename family`,
      body: [
        `The schema snapshot comes from an older ohne and does not record which tables the ${ownerNoun(fromOwner)} owns.`,
        `The renamed family recomputes from the new field tree instead - and \`${toPrimary}\` is not in it, so the fields changed in the same deploy as the rename.`,
        'Deploy the rename alone on the unchanged fields first, or rename the tables physically.',
      ],
      path: meta.file,
    });
  }
  const primary: RenameMember = {
    from: fromPrimary,
    to: toPrimary,
    origin: fromPath.length === 0 ? undefined : primaryOrigin,
  };
  if (fromPath.length === 0 && !isUndefined(toOwner.block)) primary.block = toOwner.block;
  const members: RenameMember[] = [primary];

  if (state.ownership) {
    for (const [table, claim] of Object.entries(state.claimed)) {
      if (
        fromPath.length === 0 &&
        !isUndefined(fromOwner.collection) &&
        claim.companion === fromOwner.collection &&
        table !== fromPrimary
      ) {
        members.push({
          from: table,
          to: companionTableName(toOwner.collection as string),
          companion: toOwner.collection,
        });
        continue;
      }
      const origin = claim.derived;
      if (
        isUndefined(origin) ||
        !ownedBy(origin, fromOwner) ||
        !pathStartsWith(origin.path, fromPath) ||
        table === fromPrimary
      ) {
        continue;
      }
      const path = renamedPath(origin.path, fromPath, toPath);
      members.push({
        from: table,
        to: derivedTableName(derivedRootName(toOwner), path[0] as string, ...path.slice(1)),
        origin: { ...origin, ...ownerKeys(toOwner), path },
      });
    }
  } else {
    const primaryLive = state.names.has(fromPrimary);
    for (const table of state.desired) {
      const origin = table.derived;
      if (
        isUndefined(origin) ||
        !ownedBy(origin, toOwner) ||
        !pathStartsWith(origin.path, toPath) ||
        table.name === toPrimary
      ) {
        continue;
      }
      const fromMemberPath = renamedPath(origin.path, toPath, fromPath);
      const fromMember = derivedTableName(
        derivedRootName(fromOwner),
        fromMemberPath[0] as string,
        ...fromMemberPath.slice(1),
      );
      if (state.names.has(fromMember)) {
        members.push({ from: fromMember, to: table.name, origin });
      } else if (primaryLive) {
        throw ohneError({
          title: `Migration \`${meta.name}\` cannot verify the rename family`,
          body: [
            `The schema snapshot comes from an older ohne and does not record which tables the ${ownerNoun(fromOwner)} owns.`,
            `The renamed family recomputes from the new field tree instead - and its member \`${fromMember}\` is not live, so the fields changed in the same deploy as the rename.`,
            'Deploy the rename alone on the unchanged fields first, or rename the tables physically.',
          ],
          path: meta.file,
        });
      }
    }
  }

  const [head, ...rest] = members;
  rest.sort((a, b) => (a.from < b.from ? -1 : 1));
  const lowered: Extract<LoweredMigration, { kind: 'compoundRename' }> = {
    kind: 'compoundRename',
    members: [head as RenameMember, ...rest],
    to: { ...ownerKeys(toOwner), path: toPath },
  };
  if (fromPath.length === 0 && !isUndefined(fromOwner.block)) {
    lowered.blockType = { from: fromOwner.block, to: toOwner.block as string };
  }
  return lowered;
}

/**
 * Lowers a logical discard: the reading decides between a column drop and a table compound.
 *
 * A field that materialized as a live column drops as a column, on the main table or the companion.
 * A live derived table drops as a table with every nested child, deepest first.
 * Both at once refuses unless `type` pins the column; the physical spelling stays the escape hatch.
 * A collection-level discard drops the whole family, companion included, the main table last.
 * Without ownership the family cannot be enumerated, so table-grain discards refuse.
 * A block-level discard refuses outright: removing a type purges wrapper rows, which is force-only.
 *
 * A discard of the companion's last user column escalates to the whole companion table.
 * It does so only when the desired schema omits the table.
 * Migrations mutate live themselves, so a column-only drop would leave a populated companion behind.
 * The guard would still refuse that - the discard must actually unblock the sync.
 */
async function lowerDiscard(
  state: ResolveState,
  meta: MigrationMeta,
  from: LogicalAddress,
): Promise<LoweredMigration> {
  const owner = logicalOwner(meta, from);
  const root = derivedRootName(owner);

  if (isUndefined(from.field)) {
    if (!isUndefined(from.type)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` pins a \`type\` without a field`,
        body: [`A ${ownerNoun(owner)} discard names no column.`, 'Name the field, or drop `type`.'],
        path: meta.file,
      });
    }
    if (!isUndefined(owner.block)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` discards the block \`${owner.block}\``,
        body: [
          `Removing a block type purges the wrapper rows that reference \`${owner.block}\` - row-grain work outside the migration vocabulary.`,
          'Remove the block from the code and set `FORCE_SYNC` or `database.sync.force` for one boot instead.',
        ],
        path: meta.file,
      });
    }
    assertOwnership(state, meta, owner.collection as string);
    return {
      kind: 'compoundDiscard',
      tables: discardFamily(state, owner, [], ownerTableName(owner)),
    };
  }

  const segments = fieldSegments(meta, from.field);
  const column = columnReading(owner, segments);
  const table = tableReading(owner, segments);
  const mainLive = await liveColumn(state, column.table, column.column);
  const companion =
    segments.length === 1 && !isUndefined(owner.collection)
      ? companionTableName(owner.collection)
      : undefined;
  const companionLive =
    !isUndefined(companion) &&
    state.claimed[companion]?.companion === owner.collection &&
    (await liveColumn(state, companion, column.column));
  const tableLive = state.names.has(table);

  if (mainLive && companionLive) {
    throw ohneError({
      title: `Migration \`${meta.name}\` matches two readings`,
      body: [
        `\`${root}.${from.field}\` is a live column on \`${column.table}\` and on \`${companion}\` at once.`,
        'Use the physical `table` and `column` spelling to pick one.',
      ],
      path: meta.file,
    });
  }
  const home = mainLive ? column.table : companionLive ? (companion as string) : undefined;

  if (!isUndefined(from.type) || (!isUndefined(home) && !tableLive)) {
    const target = home ?? column.table;
    if (!isUndefined(companion) && target === companion) {
      if (await escalatesToCompanionTable(state, companion, column.column)) {
        return { kind: 'discardTable', from: { table: companion } };
      }
    }
    const type =
      from.type ??
      state.claimed[target]?.columns[column.column] ??
      (!isUndefined(home)
        ? (await state.describe(target)).columns.find((item) => item.name === column.column)?.type
        : undefined) ??
      'text';
    return { kind: 'discardColumn', from: { table: target, column: column.column, type } };
  }

  if (!isUndefined(home) && tableLive) {
    throw ohneError({
      title: `Migration \`${meta.name}\` matches two readings`,
      body: [
        `\`${root}.${from.field}\` is a live column on \`${home}\` and the live table \`${table}\` at once.`,
        'Pin `type` to discard the column, or use the physical `table` spelling for the table.',
      ],
      path: meta.file,
    });
  }

  if (tableLive) {
    assertOwnership(state, meta, `${root}.${from.field}`);
    return { kind: 'compoundDiscard', tables: discardFamily(state, owner, segments, table) };
  }

  return {
    kind: 'discardColumn',
    from: { table: column.table, column: column.column, type: 'text' },
  };
}

/**
 * Whether a companion-column discard covers the whole companion table.
 * True when the column is the companion's last user column and the desired schema omits the table.
 */
async function escalatesToCompanionTable(
  state: ResolveState,
  companion: string,
  column: string,
): Promise<boolean> {
  if (state.desired.some((table) => table.name === companion)) return false;
  const live = await state.describe(companion);
  const users = live.columns.filter((item) => !item.name.startsWith('_'));
  return users.length === 1 && users[0]?.name === column;
}

/**
 * The tables a table-grain discard drops: the family under the path, deepest first, primary last.
 * A collection-level discard carries the companion along; a field path and a block never own one.
 */
function discardFamily(
  state: ResolveState,
  owner: DerivedOwner,
  path: readonly string[],
  primary: string,
): string[] {
  const family = Object.entries(state.claimed)
    .filter(([table, claim]) => {
      if (table === primary) return false;
      if (
        path.length === 0 &&
        !isUndefined(owner.collection) &&
        claim.companion === owner.collection
      ) {
        return true;
      }
      const origin = claim.derived;
      return !isUndefined(origin) && ownedBy(origin, owner) && pathStartsWith(origin.path, path);
    })
    .map(([table, claim]) => ({ table, depth: claim.derived?.path.length ?? 1 }))
    .sort((a, b) => b.depth - a.depth || (a.table < b.table ? -1 : 1))
    .map((entry) => entry.table);
  return [...family, primary];
}

/**
 * The refusal for a family operation under a snapshot that never recorded ownership.
 */
function assertOwnership(state: ResolveState, meta: MigrationMeta, subject: string): void {
  if (state.ownership) return;
  throw ohneError({
    title: `Migration \`${meta.name}\` cannot enumerate \`${subject}\``,
    body: [
      'The schema snapshot comes from an older ohne and does not record which tables the discard covers.',
      'Boot or `ohne sync` once on the current schema first, or discard the tables physically.',
    ],
    path: meta.file,
  });
}

/**
 * Whether `table` exists live and holds `column`, the structural half of the reading resolution.
 */
async function liveColumn(state: ResolveState, table: string, column: string): Promise<boolean> {
  if (!state.names.has(table)) return false;
  const schema = await state.describe(table);
  return schema.columns.some((item) => item.name === column);
}

/**
 * The physical column reading of a field path: the table its prefix names, plus the last segment.
 */
function columnReading(
  owner: DerivedOwner,
  segments: readonly string[],
): { table: string; column: string } {
  const column = last(segments) as string;
  const prefix = segments.slice(0, -1);
  const table =
    prefix.length === 0
      ? ownerTableName(owner)
      : derivedTableName(derivedRootName(owner), prefix[0] as string, ...prefix.slice(1));
  return { table, column };
}

/**
 * The physical table reading of a field path: the derived table the whole path names.
 */
function tableReading(owner: DerivedOwner, segments: readonly string[]): string {
  return derivedTableName(derivedRootName(owner), segments[0] as string, ...segments.slice(1));
}

/**
 * Swaps the `from` path prefix for the `to` path on one family member's origin path.
 */
function renamedPath(
  path: DerivedOrigin['path'],
  fromPath: readonly string[],
  toPath: readonly string[],
): DerivedOrigin['path'] {
  return [...toPath, ...path.slice(fromPath.length)] as unknown as DerivedOrigin['path'];
}

/**
 * Whether `path` starts with every segment of `prefix`; an empty prefix matches everything.
 */
export function pathStartsWith(path: readonly string[], prefix: readonly string[]): boolean {
  return prefix.every((segment, index) => path[index] === segment);
}

/**
 * The shape of one grammar-legal name: a leading letter, then letters and digits, nothing else.
 * Collection and field names never carry `_`, `$`, `.`, or whitespace; those compose physically.
 */
const NAME_SHAPE = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * The owner a logical address roots at, validated against the naming grammar.
 * A collection also refuses the reserved names; blocks live behind `block_`, so none are reserved.
 */
function logicalOwner(meta: MigrationMeta, address: LogicalAddress): DerivedOwner {
  if (!isUndefined(address.block)) {
    const block = address.block;
    if (!NAME_SHAPE.test(block)) {
      throw ohneError({
        title: `Migration \`${meta.name}\` names an invalid block`,
        body: [
          `\`${block}\` cannot be a block: a name is letters and digits, starting with a letter.`,
          'Use the physical `table` spelling for names outside the grammar.',
        ],
        path: meta.file,
      });
    }
    return { block };
  }
  const collection = address.collection as string;
  if (!NAME_SHAPE.test(collection)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` names an invalid collection`,
      body: [
        `\`${collection}\` cannot be a collection: a name is letters and digits, starting with a letter.`,
        'Use the physical `table` spelling for names outside the grammar.',
      ],
      path: meta.file,
    });
  }
  if (RESERVED_COLLECTIONS.has(collection.toLowerCase())) {
    throw ohneError({
      title: `Migration \`${meta.name}\` names the reserved collection \`${collection}\``,
      body: [
        `\`${collection}\` is reserved by the framework, so no collection ever carries it.`,
        'Fix the address.',
      ],
      path: meta.file,
    });
  }
  return { collection };
}

/**
 * The kind of an owner, for the error messages: `collection` or `block`.
 */
function ownerNoun(owner: DerivedOwner): 'block' | 'collection' {
  return isUndefined(owner.collection) ? 'block' : 'collection';
}

/**
 * Splits a field path into its segments, refusing shapes outside the naming grammar.
 */
function fieldSegments(meta: MigrationMeta, field: string): string[] {
  const segments = field.split('.');
  if (segments.some((segment) => !NAME_SHAPE.test(segment))) {
    throw ohneError({
      title: `Migration \`${meta.name}\` has a malformed field path`,
      body: [
        `\`${field}\` does not read as a field path: segments are letter-led names of letters and digits, joined by \`.\`.`,
        'Use the physical `table` and `column` spelling for names outside the grammar.',
      ],
      path: meta.file,
    });
  }
  return segments;
}

/**
 * Refuses an address that carries both the logical and the physical spelling, or both owners, at once.
 */
function assertPurelyLogical(meta: MigrationMeta, address: LogicalAddress): void {
  if ('table' in address || 'column' in address) {
    throw ohneError({
      title: `Migration \`${meta.name}\` mixes address spellings`,
      body: [
        'An address is logical (`collection` or `block`, `field`) or physical (`table`, `column`), never both.',
        'Drop one spelling.',
      ],
      path: meta.file,
    });
  }
  if (!isUndefined(address.collection) && !isUndefined(address.block)) {
    throw ohneError({
      title: `Migration \`${meta.name}\` names two owners`,
      body: ['An address roots at one `collection` or one `block`, never both.', 'Drop one owner.'],
      path: meta.file,
    });
  }
}
