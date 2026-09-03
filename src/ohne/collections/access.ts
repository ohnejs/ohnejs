import type { QueryScope } from '../query/wire/apply.ts';
import type {
  AccessContext,
  CollectionAPI,
  CollectionEndpoint,
  CollectionOperation,
} from './define-collection.ts';

import { isBoolean, isUndefined } from '../../utils/index.ts';
import { ohneError } from '../error/ohne-error.ts';

/**
 * Resolves one operation's endpoint options from a collection's `api` exposure.
 * `true` and `'public'` resolve to their object spellings, so a caller reads one shape.
 * A closed operation, like an omitted `api`, is `undefined`.
 *
 * @example
 * ```ts
 * endpointOf({ read: 'public', update: true }, 'read')   // -> { public: true }
 * endpointOf({ read: 'public', update: true }, 'update') // -> {}
 * endpointOf({ read: 'public', update: true }, 'delete') // -> undefined
 * ```
 */
export function endpointOf<O extends CollectionOperation>(
  api: boolean | CollectionAPI | undefined,
  operation: O,
): CollectionEndpoint<string, O> | undefined {
  if (isBoolean(api) || isUndefined(api)) return api === true ? {} : undefined;
  const value = api[operation] as boolean | 'public' | CollectionEndpoint<string, O> | undefined;
  if (isBoolean(value) || isUndefined(value)) return value === true ? {} : undefined;
  return value === 'public' ? { public: true } : value;
}

/**
 * Resolves an endpoint's `access` verdict for one request into the scope its queries compose under.
 * `false` refuses the operation; `true`, like an omitted resolver, is the empty scope.
 * An empty `select` throws: the read path cannot express a zero-field record, so it would widen.
 *
 * @example
 * ```ts
 * await resolveAccess({ access: () => ({ where: { owner: 'u1' } }) }, { operation: 'read' })
 * // -> { where: { owner: 'u1' } }
 *
 * await resolveAccess({ access: () => false }, { operation: 'delete' })
 * // -> false
 * ```
 */
export async function resolveAccess<O extends CollectionOperation>(
  endpoint: CollectionEndpoint<string, O>,
  context: AccessContext<O>,
): Promise<QueryScope | false> {
  const verdict = isUndefined(endpoint.access) ? true : await endpoint.access(context);
  if (verdict === false) return false;
  if (verdict === true) return {};
  if (!isUndefined(verdict.select) && verdict.select.length === 0) {
    throw ohneError(
      'An `access` scope resolved an empty `select`; return `false` to refuse the operation instead',
    );
  }
  return verdict;
}
