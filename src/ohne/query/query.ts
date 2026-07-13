import type { CollectionName } from '../collections/known-collections.ts';
import type { QueryBuilder } from './builder.ts';
import type { UntypedQueryBuilder } from './untyped.ts';

import { QueryBuilderImpl } from './impl.ts';
import { queryMetadata } from './metadata.ts';

/**
 * Opens a typed query builder over a collection, the authoring surface an app reads records through.
 *
 * The collection name narrows to the generated union.
 * Every field, operator, and result row types through the generated metadata.
 * One runtime class backs it, shared with `queryUntyped`.
 *
 * @example
 * ```ts
 * const posts = await query('Posts')
 *   .where('status', 'published')
 *   .where('views', (w) => w.atLeast(100))
 *   .orderBy('publishedAt', 'desc')
 *   .findMany()
 * ```
 */
export function query<C extends CollectionName>(collection: C): QueryBuilder<C> {
  return new QueryBuilderImpl(queryMetadata(collection)) as unknown as QueryBuilder<C>;
}

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
