import { defineHandler, readQueryBody } from 'ohnejs';
import { isInteger, isString } from 'ohnejs/utils';

import type { SearchResult } from '../collections-api/search.ts';

import {
  invalidNumberError,
  invalidValueError,
  unknownParamError,
} from '../../ohne/query/wire/errors.ts';
import { requireUser } from '../auth/require-user.ts';
import { assertNoParams } from '../collections-api/gate.ts';
import { SEARCH_LIMIT, searchRecords } from '../collections-api/search.ts';

const BODY_KEYS = new Set(['q', 'limit']);

/**
 * `POST /search`
 *
 * Searches the records of every collection the signed-in user may query, for the dashboard palette.
 * The body is `{ q, limit? }`: the text to find, and the records to answer per collection.
 * Every whitespace-separated token of `q` must appear in one of a record's readable text fields.
 * Only the first ten tokens count.
 * Each collection reads as its own list read would, so its scope and middleware decide what is found.
 * A collection that refuses the caller is skipped, never an error.
 * The URL takes no params; an unknown body key, a `q` that is not a string, or a bad `limit` is a `400`.
 */
export default defineHandler(async (): Promise<{ results: SearchResult[] }> => {
  const user = await requireUser();
  assertNoParams();
  const body = await readQueryBody();
  for (const key of Object.keys(body)) {
    if (!BODY_KEYS.has(key)) throw unknownParamError(key);
  }
  const { q, limit = SEARCH_LIMIT } = body;
  if (!isString(q)) throw invalidValueError('q');
  if (!isInteger(limit) || limit < 1) throw invalidNumberError('limit');
  return { results: await searchRecords(user, q, limit) };
});
