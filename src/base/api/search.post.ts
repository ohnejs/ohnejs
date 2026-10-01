import { defineHandler, readQueryBody, useEvent } from 'ohnejs';
import { isInteger, isString, isUndefined } from 'ohnejs/utils';

import type { SearchResult } from '../collections-api/search.ts';

import {
  invalidNumberError,
  invalidValueError,
  unknownParamError,
} from '../../ohne/query/wire/errors.ts';
import { requireUser } from '../auth/require-user.ts';
import { assertNoParams } from '../collections-api/gate.ts';
import {
  SEARCH_LIMIT,
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_OFFSET,
  searchRecords,
} from '../collections-api/search.ts';

const BODY_KEYS = new Set(['q', 'limit', 'collection', 'offset']);

/**
 * `POST /search`
 *
 * Searches the records of every collection the signed-in user may query, for the dashboard palette.
 * The body is `{ q, limit?, collection?, offset? }`: the text to find, and how many to answer per collection.
 * `collection` searches that one alone and `offset` skips its first matches, so the palette pages through it.
 * Each of `q`'s `searchTokens` must match one of a record's own fields; a whole `UUID` finds its record.
 * Each collection reads as its own list read would, so its scope and middleware decide what is found.
 * A collection that refuses the caller is skipped, never an error, and so is an unknown `collection`.
 * `limit` lowers to `SEARCH_MAX_LIMIT`, and an `offset` past `SEARCH_MAX_OFFSET` answers nothing.
 * A client that goes away stops the search before its next collection.
 * The URL takes no params; an unknown body key, a `q` that is not a string, or a bad window is a `400`.
 */
export default defineHandler(async (): Promise<{ results: SearchResult[] }> => {
  const user = await requireUser();
  assertNoParams();
  const body = await readQueryBody();
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) throw unknownParamError(key);
  }
  const { q, limit = SEARCH_LIMIT, collection, offset = 0 } = body;
  if (!isString(q)) throw invalidValueError('q');
  if (!isInteger(limit) || limit < 1) throw invalidNumberError('limit');
  if (!isInteger(offset) || offset < 0) throw invalidNumberError('offset');
  if (!isUndefined(collection) && !isString(collection)) throw invalidValueError('collection');
  if (offset > SEARCH_MAX_OFFSET) return { results: [] };
  const window = { limit: Math.min(limit, SEARCH_MAX_LIMIT), collection, offset };
  return {
    results: await searchRecords(user, q, { ...window, signal: useEvent().request.signal }),
  };
});
