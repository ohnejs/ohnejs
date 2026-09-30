import type { User } from 'ohnejs/auth';

import { queryUntyped } from 'ohnejs';
import { groupBy, isNull, isUndefined } from 'ohnejs/utils';

import type { AITier } from '../config.ts';
import type { CloseReason, OpenOutcome, Turn, TurnBatch } from './state.ts';

import { expiredReason, loadTurns, nodeModel } from './state.ts';

/**
 * One past chat as the palette lists it.
 */
export interface ChatSummary {
  /**
   * The `UUID` of the chat's first turn, which `GET /ai/chats/[id]` opens it by.
   */
  id: string;

  /**
   * What the person first asked, as far back as the chat is still kept.
   */
  title: string;

  /**
   * When the chat's latest turn was last written, in epoch milliseconds.
   */
  updatedAt: number;
}

/**
 * One step's batch as the browser replays it.
 */
export interface ChatBatch {
  /**
   * The id the batch was reported under.
   */
  id: string;

  /**
   * The highest tier among its proposals.
   */
  kind: AITier;

  /**
   * The proposals, as the browser received them.
   */
  proposals: unknown[];

  /**
   * What the browser reported per proposal, counts and record ids only; `null` when it never did.
   */
  results: unknown[] | null;

  /**
   * The dashboard path the batch opened, or offered to.
   */
  open?: string;

  /**
   * What became of `open`, once the browser reported it.
   */
  opened?: OpenOutcome;

  /**
   * The model the flow node running a waiting batch pins its transforms to.
   */
  pinned?: string;

  /**
   * When the server last wrote the turn of a waiting batch, in epoch milliseconds.
   * Its wait for the person counts from here, as `ai.limits.turnTimeout` measures it.
   */
  since?: number;
}

/**
 * One step as the browser replays it: the text the model streamed, and the batch it ended in.
 */
export interface ChatStep {
  /**
   * The text the model streamed.
   */
  text: string;

  /**
   * The batch the step ended in, or `null` when it ended in text.
   */
  batch: ChatBatch | null;
}

/**
 * One turn of a past chat, in the shape the palette keeps a live turn in.
 */
export interface ChatTurn {
  /**
   * The turn's `UUID`, which a follow-up names as `after`.
   */
  id: string;

  /**
   * What the person typed.
   */
  input: string;

  /**
   * The skill the turn started with, or `null` for none.
   */
  skill: string | null;

  /**
   * The flow the turn walked, or `null` for a plain turn.
   */
  flow: string | null;

  /**
   * `waiting` for an open turn whose last batch awaits the person, `error` for a turn a failure closed.
   * `closed` for any other.
   */
  status: 'waiting' | 'closed' | 'error';

  /**
   * Why the turn closed, `running` for one still answering elsewhere, or `null` for one waiting.
   */
  reason: CloseReason | 'running' | null;

  /**
   * The steps that streamed text or ended in a batch, in order.
   */
  steps: ChatStep[];

  /**
   * Always `null`: a replayed turn waits on no retry.
   */
  wait: null;
}

/**
 * How many of the person's latest turns `listChats` reads to find their chats.
 */
const CHAT_WINDOW = 200;

/**
 * The reasons a failure closes a turn with, which the palette shows as an error.
 */
const FAILURES = new Set<CloseReason | null>(['timeout', 'provider', 'internal']);

/**
 * The person's latest chats, newest activity first, at most `limit`.
 * It reads the person's latest turns and groups each follow-up under its chat's first turn.
 * The title is the oldest input still in that window, so a pruned first question gives way to the next.
 * A turn without `input`, written before the column, is left out.
 */
export async function listChats(user: User, limit = 20): Promise<ChatSummary[]> {
  const rows = await queryUntyped('AITurns')
    .unscoped()
    .where({ user: user.UUID, input: { not: { isNull: true } } })
    .orderBy('UUID', 'desc')
    .limit(CHAT_WINDOW)
    .select('UUID', 'chat', 'input', '_updatedAt')
    .findMany();
  const chats = groupBy(rows, (row) => (row.chat ?? row.UUID) as string);
  return Object.entries(chats)
    .map(([id, group = []]) => ({
      id,
      title: group.at(-1)?.input as string,
      updatedAt: Math.max(...group.map((row) => row._updatedAt as number)),
    }))
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit);
}

/**
 * The turns of the person's chat `id`, oldest first, or `undefined` when they have no such chat.
 * `id` is the chat's first turn; someone else's chat, or a follow-up's id, reads as none.
 * An open last turn that can no longer continue replays as closed, and the row stays unwritten.
 */
export async function loadChat(user: User, id: string): Promise<ChatTurn[] | undefined> {
  const turns = await loadTurns(
    { user: user.UUID, or: [{ UUID: id, chat: { isNull: true } }, { chat: id }] },
    { transcript: false },
  );
  const last = turns.at(-1);
  if (isUndefined(last)) return undefined;
  const reason = isNull(last.closedAt) ? expiredReason(last) : null;
  if (!isNull(reason)) turns[turns.length - 1] = { ...last, closedAt: Date.now(), reason };
  return turns.map(chatTurn);
}

/**
 * A stored turn in the shape the palette replays: each step's text and batch, the transcript left out.
 * A step with neither text nor a batch is dropped.
 *
 * @example
 * ```ts
 * chatTurn({ ...turn, step: 2, texts: ['Reading.', 'Nobody.'], batches: [read] }).steps
 * // -> [{ text: 'Reading.', batch: { id, kind, proposals, results } }, { text: 'Nobody.', batch: null }]
 * ```
 */
export function chatTurn(turn: Turn): ChatTurn {
  const steps: ChatStep[] = [];
  for (let step = 1; step <= turn.step; step += 1) {
    const text = turn.texts[step - 1] ?? '';
    const batch = turn.batches.find((entry) => entry.step === step);
    if (text === '' && isUndefined(batch)) continue;
    const waiting = waits(turn) && batch === turn.batches.at(-1);
    steps.push({
      text,
      batch: isUndefined(batch) ? null : chatBatch(batch, waiting ? turn : null),
    });
  }
  return {
    id: turn.UUID,
    input: turn.input ?? '',
    skill: turn.skill,
    flow: turn.flow?.name ?? null,
    status: FAILURES.has(turn.reason) ? 'error' : waits(turn) ? 'waiting' : 'closed',
    reason: isNull(turn.closedAt) && !waits(turn) ? 'running' : turn.reason,
    steps,
    wait: null,
  };
}

/**
 * Whether the open `turn` waits on the person to answer its last batch.
 */
function waits(turn: Turn): boolean {
  const last = turn.batches.at(-1);
  return isNull(turn.closedAt) && !isUndefined(last) && isUndefined(last.reported);
}

/**
 * A stored batch as the browser replays it.
 * A batch the open `waiting` turn still waits on carries when its wait began, and the model a flow node pins.
 */
function chatBatch(batch: TurnBatch, waiting: Turn | null): ChatBatch {
  const pinned = isNull(waiting) ? undefined : nodeModel(waiting);
  return {
    id: batch.id,
    kind: batch.kind,
    proposals: batch.proposals.map((entry) => entry.proposal),
    results: batch.reported ?? null,
    ...(isUndefined(batch.open) ? {} : { open: batch.open.path }),
    ...(isUndefined(batch.opened) ? {} : { opened: batch.opened }),
    ...(isUndefined(pinned) ? {} : { pinned }),
    ...(isNull(waiting) ? {} : { since: waiting.updatedAt }),
  };
}
