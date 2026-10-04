import { defineHandler, readQueryBody, useEvent } from 'ohnejs';
import { isArray, isInteger, isString, isUndefined } from 'ohnejs/utils';

import type { SearchAnswer } from '../collections-api/search.ts';

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

const BODY_KEYS = new Set(['q', 'limit', 'collection', 'via', 'offset', 'exclude']);

/**
 * `POST /search`
 *
 * Searches the records of every collection the signed-in user may query, for the dashboard palette.
 * The body is `{ q, limit?, collection?, via?, offset?, exclude? }`: the text to find, and what to answer.
 * `limit` caps the records per collection and per related group.
 * Each of `q`'s `searchTokens` must match one of a record's own fields; a whole `UUID` finds its record.
 * Related results follow the direct ones, each with `via`: a word matched a record it links to.
 * A whole `UUID` also lists the records linking to it.
 * `collection` searches that one alone and `offset` skips its first matches, so the palette pages through it.
 * With `via` beside it, the request pages that collection's records found through `via` instead.
 * `exclude` names collections the search leaves out, as if the user could not read them.
 * Each collection reads as its own list read would, so its scope and middleware decide what is found.
 * A collection that refuses the caller is skipped, never an error.
 * So is an unknown `collection` or `via`, or a `via` the collection never links to.
 * `limit` lowers to `SEARCH_MAX_LIMIT`, and an `offset` past `SEARCH_MAX_OFFSET` answers nothing.
 * Past `RELATED_PASSES` related groups for words, the rest are left out and the answer is `truncated`.
 * A client that goes away stops the search before its next read.
 * The URL takes no params; an unknown body key, a `q` that is not a string, or a bad window is a `400`.
 * So is a `via` without `collection`, or an `exclude` that is not a list of names.
 */
export default defineHandler(async (): Promise<SearchAnswer> => {
  const user = await requireUser();
  assertNoParams();
  const body = await readQueryBody();
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) throw unknownParamError(key);
  }
  const { q, limit = SEARCH_LIMIT, collection, via, offset = 0, exclude } = body;
  if (!isString(q)) throw invalidValueError('q');
  if (!isInteger(limit) || limit < 1) throw invalidNumberError('limit');
  if (!isInteger(offset) || offset < 0) throw invalidNumberError('offset');
  if (!isUndefined(collection) && !isString(collection)) throw invalidValueError('collection');
  if (!isUndefined(via) && (!isString(via) || isUndefined(collection))) {
    throw invalidValueError('via');
  }
  if (!isUndefined(exclude) && !(isArray(exclude) && exclude.every(isString))) {
    throw invalidValueError('exclude');
  }
  if (offset > SEARCH_MAX_OFFSET) return { results: [] };
  const window = { limit: Math.min(limit, SEARCH_MAX_LIMIT), collection, via, offset, exclude };
  return searchRecords(user, q, { ...window, signal: useEvent().request.signal });
});
