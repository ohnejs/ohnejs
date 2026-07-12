import type { Dialect, LogicalType } from '../../database/dialect.ts';
import type { QueryIR } from '../ir.ts';
import type { CollectionQueryMeta } from '../metadata.ts';

import { isNull, isUndefined } from '../../../utils/index.ts';

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
 * Compiles the `SELECT ... FROM` head and names the columns each row assembles from.
 *
 * Column-bearing fields in declaration order form the projection; column-less fields hydrate elsewhere.
 * `UUID` is always fetched, since relation anchoring needs it, but is stripped from an unselecting read.
 * A `select` narrows the output to its named fields; the full record is read when none was set.
 * A projection that names no column still fetches `UUID` alone, never falling back to `SELECT *`.
 */
export function compileSelect(
  ir: QueryIR,
  meta: CollectionQueryMeta,
  dialect: Dialect,
): { sql: string; output: SelectedColumn[] } {
  const output: SelectedColumn[] = [];
  const fetched: SelectedColumn[] = [];
  for (const [name, field] of Object.entries(meta.fields)) {
    if (isUndefined(field.column) || isUndefined(field.logicalType)) continue;
    const selected = isNull(ir.select) || ir.select.includes(name);
    const entry: SelectedColumn = { name, column: field.column, logicalType: field.logicalType };
    if (selected) {
      output.push(entry);
      fetched.push(entry);
    } else if (name === 'UUID') {
      fetched.push(entry);
    }
  }
  const columns = fetched.map((entry) => dialect.quote(entry.column)).join(', ');
  return { sql: `SELECT ${columns} FROM ${dialect.quote(meta.table)}`, output };
}
