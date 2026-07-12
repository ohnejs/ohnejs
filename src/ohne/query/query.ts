import type { UntypedQueryBuilder } from './untyped.ts';

import { QueryBuilderImpl } from './impl.ts';
import { queryMetadata } from './metadata.ts';

/**
 * Opens an untyped query builder over a collection, the entry the wire path and internals use.
 *
 * The collection must exist; its metadata resolves and memoizes on first use.
 *
 * @example
 * ```ts
 * await queryUntyped('Posts').where({ status: 'published' }).findMany()
 * ```
 */
export function queryUntyped(collection: string): UntypedQueryBuilder {
  return new QueryBuilderImpl(queryMetadata(collection));
}
