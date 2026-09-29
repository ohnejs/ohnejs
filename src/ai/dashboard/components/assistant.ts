import { api, useRoute } from 'ohnejs/dashboard';
import { isUndefined, parseSSE, sleep, untracked } from 'ohnejs/utils';

import type { Approval, SendTransport } from './send-queue.ts';
import type { BatchResult, TurnBatch } from './turn-store.ts';

import { aiMeta } from './_ai-meta.ts';
import { fetchWithRetry, postResults, sendBatch } from './send-queue.ts';
import {
  applyTurnEvent,
  currentTurn,
  markTurn,
  nextStep,
  openTurn,
  pendingBatch,
  sending,
  settleBatch,
  turnSettled,
} from './turn-store.ts';

const TRANSPORT: SendTransport = { api, sleep };

/**
 * The longest decline note the results route takes; a longer one would refuse the whole batch.
 */
const MAX_NOTE = 1_000;

/**
 * The reason a refused turn request answers, by its status; any other status is an internal failure.
 */
const REASONS: Readonly<Record<number, string>> = {
  401: 'signedOut',
  403: 'forbidden',
  404: 'off',
  409: 'turnGone',
  429: 'limit',
  503: 'unavailable',
};

/**
 * Asks the assistant: opens a turn for `input` on the server and streams its first step into the store.
 * `skill` starts the turn with that skill's instructions.
 * A read batch runs at once; any other waits in the palette for the person.
 * Nothing happens while a turn still runs, since the store follows one turn at a time.
 */
export async function ask(input: string, skill?: string): Promise<void> {
  if (!untracked(turnSettled)) return;
  openTurn(input, skill ?? null);
  const page = useRoute()?.path ?? '/';
  const body = { input, page, ...(isUndefined(skill) ? {} : { skill }) };
  let response: Response;
  try {
    response = await fetchWithRetry(TRANSPORT, 'POST /ai/turns', json(body));
  } catch {
    markTurn('error', 'network');
    return;
  }
  await consume(response);
}

/**
 * Answers the batch that waits: sends what `approvals` allow, posts the results, streams the next step.
 * A batch that no longer waits is left alone.
 */
export async function answer(batch: TurnBatch, approvals: readonly Approval[]): Promise<void> {
  const turn = currentTurn();
  if (isUndefined(turn) || turn.id === null || pendingBatch()?.id !== batch.id) return;
  markTurn('sending');
  const limit = untracked(aiMeta)?.resultSize ?? Number.POSITIVE_INFINITY;
  let results: BatchResult[];
  try {
    results = await sendBatch(batch, approvals, TRANSPORT, {
      limit,
      onProgress: (sent, total) => {
        sending.value = { sent, total };
      },
    });
  } catch {
    sending.value = null;
    markTurn('error', 'network');
    return;
  }
  sending.value = null;
  settleBatch(results);
  nextStep();
  let response: Response | undefined;
  try {
    response = await postResults(TRANSPORT, turn.id, batch.id, results);
  } catch {
    markTurn('error', 'network');
    return;
  }
  if (!isUndefined(response)) await consume(response);
}

/**
 * Declines the batch that waits: its reads still run, every write answers the person's decline with `note`.
 * The note is cut to what the results route takes.
 */
export function decline(batch: TurnBatch, note?: string): Promise<void> {
  const said = note?.trim().slice(0, MAX_NOTE) ?? '';
  const declined: Approval = said === '' ? { send: false } : { send: false, note: said };
  return answer(
    batch,
    batch.proposals.map((proposal) => (proposal.tier === 'read' ? { send: true } : declined)),
  );
}

/**
 * Reads one step's stream into the store, then runs a read batch without asking.
 * A refused request fails the turn with the reason its status names.
 */
async function consume(response: Response): Promise<void> {
  if (!response.ok || response.body === null) {
    markTurn('error', REASONS[response.status] ?? 'internal');
    return;
  }
  try {
    for await (const message of parseSSE(response.body)) applyTurnEvent(message);
  } catch {
    markTurn('error', 'network');
    return;
  }
  if (currentTurn()?.status === 'streaming') markTurn('error', 'network');
  const batch = pendingBatch();
  if (!isUndefined(batch) && batch.kind === 'read') {
    await answer(
      batch,
      batch.proposals.map(() => ({ send: true })),
    );
  }
}

/**
 * The fetch options of a JSON post.
 */
function json(body: unknown): RequestInit {
  return { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}
