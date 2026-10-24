import type { APIError } from './api-error.ts';

import { isUndefined } from '../../utils/is/is-undefined.ts';
import { setCapped } from '../../utils/map/set-capped.ts';
import { untracked } from '../../utils/reactive/untracked.ts';
import { dataChangeCount } from './data-changes.ts';

/**
 * How a read settled: its parsed value, or the failure.
 */
export type Settled = { value: unknown; error?: never } | { error: APIError; value?: never };

/**
 * One subscriber's hold on a shared request.
 */
export interface FlightTicket {
  /**
   * Settles with the answer, or `undefined` once the request was aborted.
   */
  settled: Promise<Settled | undefined>;

  /**
   * Drops this hold; the last one released aborts the request.
   */
  release(): void;
}

/**
 * A cached answer, and whether it stands in for another query of the same read.
 */
export interface CachedAnswer {
  /**
   * The answered value.
   */
  value: unknown;

  /**
   * Whether the value was answered for another query.
   */
  stale: boolean;
}

interface Answer {
  value: unknown;
  sequence: number;
}

interface Flight {
  settled: Promise<Settled | undefined>;
  controller: AbortController;
  holds: number;
  changes: number;
}

const LIMIT = 100;

const answers = new Map<string, Answer>();
const latest = new Map<string, string>();
const flights = new Map<string, Flight>();
let epoch = 0;
let sequence = 0;

/**
 * The answer cached for `key`, else the last one cached under `standInKey` marked stale.
 * A hit counts as a use, so it outlives older entries.
 */
export function cachedAnswer(key: string, standInKey: string): CachedAnswer | undefined {
  const own = touch(key);
  if (!isUndefined(own)) return { value: own.value, stale: false };
  const standIn = latest.get(standInKey);
  const other = isUndefined(standIn) ? undefined : touch(standIn);
  return isUndefined(other) ? undefined : { value: other.value, stale: true };
}

/**
 * Holds the request in flight for `key`, or starts one with `send`.
 * A `fresh` join always starts a new request; later joins share that one.
 * A request sent before the latest `markDataChanged` is never shared, so every join after it reads anew once.
 * A value it answers is cached under `key` and as the newest under `standInKey`.
 * A request settling after a later one for `key` already answered settles with that newer answer instead.
 * The request is aborted once every hold is released.
 */
export function joinFlight(
  key: string,
  standInKey: string,
  send: (signal: AbortSignal) => Promise<Settled | undefined>,
  fresh: boolean,
): FlightTicket {
  const changes = untracked(dataChangeCount);
  let flight = fresh ? undefined : flights.get(key);
  if (isUndefined(flight) || flight.changes !== changes) {
    const controller = new AbortController();
    const sentIn = epoch;
    const order = ++sequence;
    const started: Flight = {
      controller,
      holds: 0,
      changes,
      settled: send(controller.signal).then((settled) => {
        if (flights.get(key) === started) flights.delete(key);
        if (sentIn !== epoch || isUndefined(settled)) return settled;
        const newer = answers.get(key);
        if (!isUndefined(newer) && newer.sequence > order) return { value: newer.value };
        if (isUndefined(settled.error)) {
          setCapped(answers, key, { value: settled.value, sequence: order }, LIMIT);
          setCapped(latest, standInKey, key, LIMIT);
        }
        return settled;
      }),
    };
    flights.set(key, started);
    flight = started;
  }
  const held = flight;
  held.holds += 1;
  let released = false;
  return {
    settled: held.settled,
    release: () => {
      if (released) return;
      released = true;
      held.holds -= 1;
      if (held.holds > 0) return;
      held.controller.abort();
      if (flights.get(key) === held) flights.delete(key);
    },
  };
}

/**
 * Forgets every cached answer and stops sharing requests already in flight.
 * An answer still on its way is no longer cached either.
 * A sign-in or sign-out calls it, so no answer crosses from one session into the next.
 */
export function clearResourceCache(): void {
  answers.clear();
  latest.clear();
  flights.clear();
  epoch += 1;
}

/**
 * Reads the answer for `key`, marking it the most recently used.
 */
function touch(key: string): Answer | undefined {
  const answer = answers.get(key);
  if (!isUndefined(answer)) setCapped(answers, key, answer, LIMIT);
  return answer;
}
