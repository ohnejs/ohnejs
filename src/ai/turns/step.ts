import type { EventStream } from 'ohnejs';
import type { User } from 'ohnejs/auth';

import { ohneError, sendEvents, useEvent, useRequest, useSkills } from 'ohnejs';
import { userCan } from 'ohnejs/auth';
import { isArray, isNull, isString, isUndefined, pick } from 'ohnejs/utils';
import { randomToken } from 'ohnejs/utils/crypto';

import type { AITier } from '../config.ts';
import type {
  DoneEvent,
  Provider,
  StepRequest,
  ToolCall,
  ToolResult,
  TranscriptItem,
  Usage,
} from '../providers/provider.ts';
import type { BatchResult } from './receipts.ts';
import type { BatchCall, BatchProposal, Turn, TurnBatch } from './state.ts';
import type { Surface } from './surface.ts';

import { useAIConfig } from '../config.ts';
import { isProviderError } from '../providers/provider.ts';
import { chargeTokens, stepSignal } from './limits.ts';
import { buildPrompt, skillFence } from './prompt.ts';
import { checkProposal } from './proposals.ts';
import { shapeReceipt } from './receipts.ts';
import { modelSeesValues } from './redact.ts';
import { closeTurn, saveTurn } from './state.ts';
import { describeCollection, renderSurface } from './surface.ts';
import { TOOLS } from './tools.ts';

/**
 * What one step runs on.
 */
export interface StepRun {
  /**
   * The turn, loaded or just opened; the step writes it back.
   */
  turn: Turn;

  /**
   * The person the turn belongs to.
   */
  user: User;

  /**
   * The provider of the turn's model.
   */
  provider: Provider;

  /**
   * Frees the step's permit; the stream calls it once it ends.
   */
  release: () => void;
}

/**
 * How often the stream pings while the provider is silent.
 */
const HEARTBEAT = '15s';

const TIER_RANK: Record<AITier, number> = { read: 0, write: 1, destructive: 2 };

/**
 * Opens the event stream of one step and runs the step behind it.
 * The stream ends when the step does, whichever way; the permit frees with it.
 * `opening` is sent first, before anything the step streams.
 * The handler returns the body as is.
 */
export function streamStep(
  run: StepRun,
  opening?: { event: string; data: unknown },
): ReadableStream<Uint8Array> {
  const stream = sendEvents({ heartbeat: HEARTBEAT, onClose: run.release });
  if (!isUndefined(opening)) send(stream, opening.event, opening.data);
  useEvent().waitUntil(runStep(run, stream).finally(() => stream.close()));
  return stream.body;
}

/**
 * Runs one step: renders the surface, streams the provider, charges the tokens, and writes the turn back.
 * Text and retries stream as they come.
 * A step that ends in calls becomes a batch, streamed for the browser to answer, and the turn waits.
 * One that ends any other way closes the turn, as does the step that reaches `ai.limits.steps`.
 * A failure streams `error` with its code and closes the turn; the client leaving streams nothing.
 * A step that ends before `done` is charged its estimated input, since the provider bills it all the same.
 */
export async function runStep(
  { turn, user, provider }: StepRun,
  stream: EventStream,
): Promise<void> {
  const { signal } = useRequest();
  const deadline = stepSignal();
  let request: StepRequest | undefined;
  let charged = false;
  try {
    const surface = await renderSurface(user, modelSeesValues(turn.model));
    request = {
      system: buildPrompt(surface.text, { user, page: turn.page }),
      tools: [...TOOLS],
      transcript: turn.transcript,
    };
    let done: DoneEvent | undefined;
    for await (const event of provider.step(request, deadline)) {
      if (event.type === 'text') send(stream, 'text', { text: event.text });
      else if (event.type === 'retry') send(stream, 'retry', { wait: event.wait });
      else done = event;
    }
    if (isUndefined(done)) throw ohneError('The provider ended the step without `done`');
    charged = true;
    await chargeTokens(user, done.usage);
    turn.usage = addUsage(turn.usage, done.usage);
    turn.transcript = [...turn.transcript, ...done.items];
    const batch = done.stop === 'calls' ? await buildBatch(done.calls, surface, user, turn) : null;
    const reason = isNull(batch)
      ? done.stop
      : turn.step >= useAIConfig().limits.steps
        ? 'steps'
        : 'batch';
    if (reason === 'batch' && !isNull(batch)) turn.batches = [...turn.batches, batch];
    else turn.closedAt = Date.now();
    if (!(await saveTurn(turn, turn.step))) {
      throw ohneError(`Turn \`${turn.UUID}\` moved past step ${turn.step}`);
    }
    if (reason === 'batch' && !isNull(batch)) {
      const proposals = batch.proposals.map((entry) => entry.proposal);
      send(stream, 'batch', { id: batch.id, kind: batch.kind, proposals });
    }
    send(stream, 'done', { reason });
  } catch (error) {
    if (!charged && !isUndefined(request)) await chargeTokens(user, estimatedUsage(request));
    if (signal.aborted) {
      await closeTurn(turn);
      return;
    }
    const code = deadline.aborted ? 'timeout' : isProviderError(error) ? 'provider' : 'internal';
    send(stream, 'error', { code });
    await closeTurn(turn);
    if (code === 'internal') throw error;
  }
}

/**
 * Fills the pending batch with what the browser reported and returns the transcript items answering it.
 * Each result shapes the receipt of its proposal; the calls the server answered itself keep their content.
 * Record values ride along only when `model` may see them.
 * Valid only within a request.
 */
export async function answerBatch(
  batch: TurnBatch,
  results: BatchResult[],
  provider: Provider,
  model: string,
): Promise<TranscriptItem[]> {
  const values = modelSeesValues(model);
  for (const [index, entry] of batch.proposals.entries()) {
    const call = batch.calls[entry.call];
    (call.receipts ??= [])[entry.index] = await shapeReceipt(entry, results[index], values);
  }
  batch.reported = results.map((result) =>
    'declined' in result ? result : { status: result.status },
  );
  return provider.transcript.results(batch.calls.map(toolResult));
}

/**
 * Sends one event with a JSON payload.
 */
function send(stream: EventStream, event: string, data: unknown): void {
  stream.send(JSON.stringify(data), { event });
}

/**
 * The batch of a step's calls: proposals checked, `describe` and `skill` answered, bad calls refused.
 */
async function buildBatch(
  calls: ToolCall[],
  surface: Surface,
  user: User,
  turn: Turn,
): Promise<TurnBatch> {
  const batch: TurnBatch = {
    id: randomToken(16),
    step: turn.step,
    kind: 'read',
    calls: [],
    proposals: [],
  };
  for (const call of calls) {
    if (call.name === 'request') {
      batch.calls.push(await requestCall(call, surface, batch));
    } else if (call.name === 'describe') {
      batch.calls.push(describeCall(call, surface));
    } else if (call.name === 'skill') {
      batch.calls.push(skillCall(call, user));
    } else {
      batch.calls.push(errorCall(call, { error: 'unknownTool' }));
    }
  }
  return batch;
}

/**
 * Checks a `request` call's proposals, filing each accepted one on the batch and each refusal as a receipt.
 * A call that would take the step past `ai.limits.requests` is refused whole.
 */
async function requestCall(call: ToolCall, surface: Surface, batch: TurnBatch): Promise<BatchCall> {
  const { requests } = call.input;
  if (!isArray(requests)) return errorCall(call, { error: 'invalidShape', path: 'requests' });
  const max = useAIConfig().limits.requests;
  // The results body is sized for `max` answers per step, so the cap spans every call of it.
  if (batch.proposals.length + requests.length > max) {
    return errorCall(call, { error: 'tooManyRequests', max });
  }
  const receipts: BatchCall['receipts'] = [];
  for (const [index, input] of requests.entries()) {
    const checked = await checkProposal(input, surface);
    if (!checked.ok) {
      receipts.push(checked.receipt);
      continue;
    }
    const { route, proposal, identity } = checked.accepted;
    const entry: BatchProposal = {
      call: batch.calls.length,
      index,
      route: pick(route, ['method', 'pattern', 'body', 'collection']),
      proposal,
      identity,
    };
    batch.proposals.push(entry);
    if (TIER_RANK[route.tier] > TIER_RANK[batch.kind]) batch.kind = route.tier;
    receipts.push(null);
  }
  return { id: call.id, name: call.name, receipts };
}

/**
 * Answers a `describe` call with the collection's surface block, or an error for one the model cannot reach.
 */
function describeCall(call: ToolCall, surface: Surface): BatchCall {
  const { collection } = call.input;
  const reachable = isString(collection) ? surface.collections.get(collection) : undefined;
  if (isUndefined(reachable)) return errorCall(call, { error: 'unknownCollection' });
  return { id: call.id, name: call.name, content: describeCollection(reachable) };
}

/**
 * Answers a `skill` call with the skill's fence, or an error for one the person may not start.
 */
function skillCall(call: ToolCall, user: User): BatchCall {
  const { name } = call.input;
  const skill = isString(name) ? useSkills().get(name)?.skill : undefined;
  if (isUndefined(skill) || (!isUndefined(skill.capability) && !userCan(user, skill.capability))) {
    return errorCall(call, { error: 'unknownSkill' });
  }
  return { id: call.id, name: call.name, content: skillFence(name as string, skill.prompt) };
}

/**
 * A call the server refuses whole, its reason as the model reads it.
 */
function errorCall(call: ToolCall, reason: Record<string, unknown>): BatchCall {
  return { id: call.id, name: call.name, content: JSON.stringify(reason), error: true };
}

/**
 * The answer to one call, in the provider's shape.
 */
function toolResult(call: BatchCall): ToolResult {
  const content = call.content ?? JSON.stringify(call.receipts ?? []);
  return { id: call.id, content, ...(call.error ? { error: true } : {}) };
}

/**
 * A step's input as fresh tokens, estimated at four characters a token, for a step that ended before `done`.
 */
function estimatedUsage(request: StepRequest): Usage {
  return {
    fresh: Math.ceil(JSON.stringify(request).length / 4),
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
  };
}

/**
 * The sum of two usages.
 */
function addUsage(a: Usage, b: Usage): Usage {
  return {
    fresh: a.fresh + b.fresh,
    cacheRead: a.cacheRead + b.cacheRead,
    cacheWrite: a.cacheWrite + b.cacheWrite,
    output: a.output + b.output,
  };
}
