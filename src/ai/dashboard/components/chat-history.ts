import { api, sessionUser } from 'ohnejs/dashboard';
import { isNullish, isUndefined, type Ref, ref, untracked } from 'ohnejs/utils';

import type { Turn } from './turn-store.ts';

import { decline } from './assistant.ts';
import { pendingBatch, replaceTurns, runsUnasked, turns, turnSettled } from './turn-store.ts';

/**
 * How long to wait before asking again when the server could not tell whether a batch still waits.
 */
const RECHECK = 30_000;

/**
 * One past chat as `GET /ai/chats` lists it.
 */
export interface ChatSummary {
  /**
   * The `UUID` of the chat's first turn, which reopens it.
   */
  id: string;

  /**
   * What the person first asked.
   */
  title: string;

  /**
   * When the chat was last written, in epoch milliseconds.
   */
  updatedAt: number;
}

/**
 * The person's latest chats, newest first, as the server last listed them.
 * Reactive.
 */
export const recentChats: Ref<readonly ChatSummary[]> = ref([]);

/**
 * Reads the person's latest chats into `recentChats`.
 * A refused or failed read keeps the list it had, and one that lands after the person changed is dropped.
 */
export async function loadRecentChats(): Promise<void> {
  const person = untracked(sessionUser)?.UUID;
  try {
    const response = await api('GET /ai/chats');
    if (!response.ok) return;
    const { chats } = (await response.json()) as { chats: ChatSummary[] };
    if (untracked(sessionUser)?.UUID === person) recentChats.value = chats;
  } catch {
    return;
  }
}

/**
 * Reopens the chat `id` as the conversation, so the next follow-up continues it.
 * Nothing happens while a turn still runs, or when the read fails.
 * A chat the server no longer keeps leaves `recentChats`.
 * A waiting batch that ran unasked was cut off by a reload, so it answers as declined: its reads run again.
 */
export async function openChat(id: string): Promise<void> {
  if (!untracked(turnSettled)) return;
  try {
    const response = await api(`GET /ai/chats/${id}`);
    if (response.status === 404) {
      recentChats.value = recentChats.value.filter((chat) => chat.id !== id);
      return;
    }
    if (!response.ok) return;
    const { turns } = (await response.json()) as { turns: Turn[] };
    if (!untracked(turnSettled)) return;
    replaceTurns(turns);
    const batch = pendingBatch();
    if (!isUndefined(batch) && runsUnasked(batch)) await decline(batch);
  } catch {
    return;
  }
}

/**
 * When the server closes the waiting batch `id` of the conversation shown: its last write plus `timeout`.
 * `undefined` once the server no longer has it waiting; a failed read answers a short while from now.
 */
export async function waitingUntil(id: string, timeout: number): Promise<number | undefined> {
  const chat = untracked(() => turns.value[0]?.id);
  if (isNullish(chat)) return undefined;
  try {
    const response = await api(`GET /ai/chats/${chat}`);
    if (response.status === 404) return undefined;
    if (!response.ok) return Date.now() + RECHECK;
    const { turns: stored } = (await response.json()) as { turns: Turn[] };
    const last = stored.at(-1);
    const batch = last?.steps.at(-1)?.batch;
    if (last?.status !== 'waiting' || batch?.id !== id) return undefined;
    return (batch.since ?? Date.now()) + timeout;
  } catch {
    return Date.now() + RECHECK;
  }
}
