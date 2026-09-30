import { closePalette } from 'app/components/palette-state.ts';
import { api, navigate, useRoute } from 'ohnejs/dashboard';
import { isUndefined, parseSSE, sleep, untracked } from 'ohnejs/utils';

import type { Approval, SendTransport } from './send-queue.ts';
import type { BatchResult, OpenOutcome, TurnBatch } from './turn-store.ts';

import { aiMeta } from './_ai-meta.ts';
import { turnModel } from './_ai-model-pick.ts';
import { fetchWithRetry, postResults, sendBatch } from './send-queue.ts';
import {
  applyTurnEvent,
  clearTurns,
  currentTurn,
  markTurn,
  nextStep,
  openTurn,
  pendingBatch,
  replaceTurns,
  runsUnasked,
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
 * Options for `ask`.
 */
export interface AskOptions {
  /**
   * The skill whose instructions start the turn.
   */
  skill?: string;

  /**
   * The flow the turn walks from its start.
   */
  flow?: string;

  /**
   * The id of the settled turn this one follows up on, so the model continues that conversation.
   */
  after?: string;
}

/**
 * Asks the assistant: opens a turn for `input` on the server and streams its first step into the store.
 * The turn plans on the model the person picked, when it is not the app's default.
 * A `skill` starts it with that skill's instructions; a `flow` walks that flow instead.
 * A follow-up the server cannot continue answers `409`; the question is then asked afresh, alone in the view.
 * A batch of reads and `auto` writes runs at once; any other waits in the palette for the person.
 * A batch that names a page closes the palette and opens it once answered; a declined batch leaves it.
 * Nothing happens while a turn still runs, since the store follows one turn at a time.
 */
export async function ask(input: string, { skill, flow, after }: AskOptions = {}): Promise<void> {
  if (!untracked(turnSettled)) return;
  if (isUndefined(after)) clearTurns();
  openTurn(input, { skill, flow });
  const page = useRoute()?.path ?? '/';
  const model = untracked(turnModel);
  const open = (follows?: string): Promise<Response> =>
    fetchWithRetry(
      TRANSPORT,
      'POST /ai/turns',
      json({
        input,
        page,
        ...(isUndefined(model) ? {} : { model }),
        ...(isUndefined(skill) ? {} : { skill }),
        ...(isUndefined(flow) ? {} : { flow }),
        ...(isUndefined(follows) ? {} : { after: follows }),
      }),
    );
  let response: Response;
  try {
    response = await open(after);
    if (response.status === 409 && !isUndefined(after)) {
      const current = currentTurn();
      if (!isUndefined(current)) replaceTurns([current]);
      response = await open();
    }
  } catch {
    markTurn('error', 'network');
    return;
  }
  await consume(response);
}

/**
 * Answers the batch that waits: sends what `approvals` allow, posts the results, streams the next step.
 * A batch that names a page closes the palette and opens it once answered; a declined batch leaves it.
 * The page opens after the writes, so it shows what they changed.
 * `open: false` leaves the page as it is.
 * A batch that no longer waits is left alone.
 */
export async function answer(
  batch: TurnBatch,
  approvals: readonly Approval[],
  { open = true }: { open?: boolean } = {},
): Promise<void> {
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
    markTurn('error', 'internal');
    return;
  }
  sending.value = null;
  const opened: OpenOutcome | undefined = isUndefined(batch.open)
    ? undefined
    : open
      ? await openPage(batch.open)
      : 'declined';
  settleBatch(results, opened);
  nextStep();
  let response: Response | undefined;
  try {
    response = await postResults(TRANSPORT, turn.id, batch.id, results, opened);
  } catch {
    markTurn('error', 'network');
    return;
  }
  if (!isUndefined(response)) await consume(response);
}

/**
 * Declines the batch that waits: its reads still run, every write answers the person's decline with `note`.
 * The note is cut to what the results route takes.
 * A page the batch names stays unopened, and the model reads it as declined.
 */
export function decline(batch: TurnBatch, note?: string): Promise<void> {
  const said = note?.trim().slice(0, MAX_NOTE) ?? '';
  const declined: Approval = said === '' ? { send: false } : { send: false, note: said };
  return answer(
    batch,
    batch.proposals.map((proposal) => (proposal.tier === 'read' ? { send: true } : declined)),
    { open: false },
  );
}

/**
 * Closes the palette and opens `path`, answering whether the location got there.
 * A guard asking about unsaved changes holds the answer until the person decides.
 */
async function openPage(path: string): Promise<OpenOutcome> {
  // Closed first, or the next page's shell would mount the palette again.
  closePalette();
  return (await navigate(path)) ? 'opened' : 'stayed';
}

/**
 * Reads one step's stream into the store, then runs a batch of reads and `auto` writes without asking.
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
  if (!isUndefined(batch) && runsUnasked(batch)) {
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
