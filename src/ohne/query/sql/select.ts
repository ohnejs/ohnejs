import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { QueryIR } from '../ir.ts';
import type { CollectionQueryMeta, FieldQueryMeta } from '../metadata.ts';
import type { SQLFragment } from './fragment.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';
import { compileFrom } from './from.ts';

/**
 * One column read back from a row: its field name, its physical column, and its logical type.
 */
export interface SelectedColumn {
  /**
   * The field name the value lands under in the assembled record.
   */
  name: string;

  /**
   * The physical column the value reads from.
   */
  column: string;

  /**
   * The logical type the value deserializes through.
   */
  logicalType: LogicalType;
}

/**
 * The column-bearing fields of a scope, in declaration order, each as a `SelectedColumn`.
 *
 * A scope is a collection's fields or a composite's subfields; column-less kinds hydrate elsewhere.
 * A `record` field is column-bearing here - its foreign-key column holds the target `UUID`.
 */
export function scopeColumns(fields: Record<string, FieldQueryMeta>): SelectedColumn[] {
  const columns: SelectedColumn[] = [];
  for (const [name, field] of Object.entries(fields)) {
    if (isUndefined(field.column) || isUndefined(field.logicalType)) continue;
    columns.push({ name, column: field.column, logicalType: field.logicalType });
  }
  return columns;
}

/**
 * Compiles the `SELECT ... FROM` head, naming the columns a top-level read fetches.
 *
 * Column-bearing fields in declaration order form the projection; column-less fields hydrate elsewhere.
 * `UUID` is always fetched, since relation anchoring needs it, even when a `select` leaves it out.
 * A `select` narrows the projection to its named fields; the full column set is read when none was set.
 * A projection that names no other column still fetches `UUID` alone, never falling back to `SELECT *`.
 * The `FROM` joins the companion at `locale` when the projection, condition, or order needs it.
 * The head's params bind before any tail param.
 */
export function compileSelect(
  ir: QueryIR,
  meta: CollectionQueryMeta,
  dialect: Dialect,
  locale: string,
): SQLFragment {
  const fetched = scopeColumns(meta.fields).filter(
    (entry) => isNull(ir.select) || ir.select.includes(entry.name) || entry.name === 'UUID',
  );
  const columns = fetched.map((entry) => dialect.quote(entry.column)).join(', ');
  const from = compileFrom(
    meta,
    { fields: fetched.map((entry) => entry.name), condition: ir.condition, order: ir.order },
    locale,
    dialect,
  );
  return { sql: `SELECT ${columns} ${from.sql}`, params: from.params };
}
