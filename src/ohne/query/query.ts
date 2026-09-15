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
 * Opens an untyped query builder over a collection, the builder `applyQuery` and other dynamic callers take.
 *
 * An unknown collection throws.
 *
 * @example
 * ```ts
 * await queryUntyped('Posts').where({ status: 'published' }).findMany()
 * ```
 */
export function queryUntyped(collection: string): UntypedQueryBuilder {
  return new QueryBuilderImpl(queryMetadata(collection));
}
