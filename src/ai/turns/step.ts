import type { EventStream } from 'ohnejs';
import type { FlowAct } from 'ohnejs';
import type { User } from 'ohnejs/auth';

import { ohneError, sendEvents, useEvent, useFlows, useRequest } from 'ohnejs';
import { isArray, isEmpty, isNull, isString, isUndefined, pick } from 'ohnejs/utils';
import { randomToken } from 'ohnejs/utils/crypto';

import type { AITier } from '../config.ts';
import type {
  DoneEvent,
  Provider,
  StepRequest,
  ToolCall,
  ToolResult,
  TranscriptItem,
} from '../providers/provider.ts';
import type { BatchResult } from './receipts.ts';
import type { Entered, Running } from './run-flow.ts';
import type { BatchCall, BatchProposal, CloseReason, FlowState, Turn, TurnBatch } from './state.ts';
import type { Surface } from './surface.ts';

import { useAIConfig } from '../config.ts';
import { addUsage, estimatedUsage, isProviderError } from '../providers/provider.ts';
import { tagAutoAccept } from './auto-accept.ts';
import { chargeTokens, stepSignal, tokenWait } from './limits.ts';
import { buildPrompt, skillFence } from './prompt.ts';
import { checkProposal } from './proposals.ts';
import { shapeReceipt } from './receipts.ts';
import { modelSeesValues } from './redact.ts';
import { enterNode, leaveNode } from './run-flow.ts';
import { usableSkill } from './skills.ts';
import { activeModel, claimStep, closeTurn, saveTurn } from './state.ts';
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
   * The provider of the model the turn runs on now.
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
 * What the model reads for a call its turn closed before answering.
 */
const CLOSED_CALL = JSON.stringify({ error: 'turnClosed' });

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
 * The batch names the node's model as `pinned` when it has one, since its transforms run there.
 * One that ends any other way closes the turn, as does the step that reaches `ai.limits.steps`.
 * A closed turn keeps why in its `reason`.
 * A closing step answers its calls as closed, so a follow-up continues from a whole transcript.
 * A flow turn first enters the act node that runs, deciding its way there; `node` names it on the stream.
 * The node's routes are those of its tiers, and its model runs it.
 * A node whose step ends in text is done: the walk goes on, and the next node steps in the same stream.
 * The walk ending closes the turn as `end`.
 * Nodes left past `ai.limits.steps` close it as `steps`, before any of them is decided or entered.
 * A node the token budget no longer admits closes it as `limit`.
 * A failure streams `error` with its code and closes the turn; the client leaving streams nothing.
 * A step that ends before `done` is charged its estimated input, since the provider bills it all the same.
 */
export async function runStep(run: StepRun, stream: EventStream): Promise<void> {
  const { turn, user } = run;
  const { signal } = useRequest();
  const { steps } = useAIConfig().limits;
  let running: Running = { model: activeModel(turn), provider: run.provider };
  let deadline = signal;
  let request: StepRequest | undefined;
  let charged = true;
  const close = async (reason: CloseReason, calls: ToolCall[] = []): Promise<void> => {
    turn.closedAt = Date.now();
    turn.reason = reason;
    turn.transcript = [...turn.transcript, ...closedCalls(calls, running.provider)];
    await save();
    send(stream, 'done', { reason });
  };
  const save = async (): Promise<void> => {
    if (!(await saveTurn(turn, turn.step))) {
      throw ohneError(`Turn \`${turn.UUID}\` moved past step ${turn.step}`);
    }
  };
  try {
    for (let chained = false; ; chained = true) {
      let act: FlowAct | undefined;
      if (!isNull(turn.flow)) {
        if (chained && !isEmpty(turn.flow.queue)) {
          if (turn.step >= steps) {
            await close('steps');
            return;
          }
          if ((await tokenWait(user)) > 0) {
            await close('limit');
            return;
          }
        }
        deadline = stepSignal();
        const entered = isNull(turn.flow.node)
          ? await enterNode(turn, user, running, deadline)
          : runningNode(turn, running);
        if (entered.status !== 'node') {
          await close(entered.status === 'ended' ? 'end' : 'limit');
          return;
        }
        act = entered.act;
        running = { model: entered.model, provider: entered.provider };
        if (chained && !(await claimStep(turn))) {
          throw ohneError(`Turn \`${turn.UUID}\` moved past step ${turn.step}`);
        }
        send(stream, 'node', { flow: turn.flow.name, node: entered.id });
      }
      const surface = await renderSurface(user, modelSeesValues(running.model), act?.tiers);
      request = {
        system: buildPrompt(surface.text, { user, page: turn.page }),
        tools: [...TOOLS],
        transcript: turn.transcript,
      };
      deadline = stepSignal();
      charged = false;
      let done: DoneEvent | undefined;
      for await (const event of running.provider.step(request, deadline)) {
        if (event.type === 'text') send(stream, 'text', { text: event.text });
        else if (event.type === 'retry') send(stream, 'retry', { wait: event.wait });
        else done = event;
      }
      if (isUndefined(done)) throw ohneError('The provider ended the step without `done`');
      charged = true;
      await chargeTokens(user, done.usage);
      turn.usage = addUsage(turn.usage, done.usage);
      turn.transcript = [...turn.transcript, ...done.items];
      const closing = done.stop !== 'calls' ? done.stop : turn.step >= steps ? 'steps' : null;
      if (closing === 'end' && !isNull(turn.flow)) {
        leaveNode(turn.flow, turn.flow.node as string);
        await save();
        continue;
      }
      if (!isNull(closing)) {
        await close(closing, done.calls);
        return;
      }
      const batch = await buildBatch(done.calls, surface, user, turn);
      turn.batches = [...turn.batches, batch];
      await save();
      const proposals = batch.proposals.map((entry) => entry.proposal);
      send(stream, 'batch', {
        id: batch.id,
        kind: batch.kind,
        proposals,
        ...(isUndefined(act?.model) ? {} : { pinned: act.model }),
      });
      send(stream, 'done', { reason: 'batch' });
      return;
    }
  } catch (error) {
    if (!charged && !isUndefined(request)) await chargeTokens(user, estimatedUsage(request));
    if (signal.aborted) {
      await closeTurn(turn, 'left');
      return;
    }
    const code = deadline.aborted ? 'timeout' : isProviderError(error) ? 'provider' : 'internal';
    // Closed before the browser hears of it, so a follow-up typed at once finds the turn closed.
    await closeTurn(turn, code);
    send(stream, 'error', { code });
    if (code === 'internal') throw error;
  }
}

/**
 * The act node a results post continues, on `running`, which the route built for its model.
 */
function runningNode(turn: Turn, running: Running): Entered {
  const flow = turn.flow as FlowState;
  const id = flow.node as string;
  const node = useFlows().get(flow.name)?.flow.nodes[id];
  if (isUndefined(node) || !('act' in node)) {
    throw ohneError(`Flow \`${flow.name}\` has no act node \`${id}\``);
  }
  return { status: 'node', id, act: node.act, ...running };
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
    'declined' in result
      ? result
      : { status: result.status, ...(result.auto === true ? { auto: true } : {}) },
  );
  return provider.transcript.results(batch.calls.map(toolResult));
}

/**
 * The transcript a follow-up of the closed `turn` starts from: its own, every call it left open closed.
 * A turn that closed while its batch waited never answered that batch; the model reads each call as closed.
 */
export function followUpTranscript(turn: Turn, provider: Provider): TranscriptItem[] {
  const pending = turn.batches.at(-1);
  if (isUndefined(pending) || !isUndefined(pending.reported)) return turn.transcript;
  return [...turn.transcript, ...closedCalls(pending.calls, provider)];
}

/**
 * The transcript items answering `calls` as closed, none for no calls.
 */
function closedCalls(calls: readonly { id: string }[], provider: Provider): TranscriptItem[] {
  if (isEmpty(calls)) return [];
  return provider.transcript.results(
    calls.map((call) => ({ id: call.id, content: CLOSED_CALL, error: true })),
  );
}

/**
 * Sends one event with a JSON payload.
 */
function send(stream: EventStream, event: string, data: unknown): void {
  stream.send(JSON.stringify(data), { event });
}

/**
 * The batch of a step's calls: proposals checked, `describe` and `skill` answered, bad calls refused.
 * Its writes are then tagged to run without asking, when the person's auto-accept covers every one.
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
  tagAutoAccept(batch, turn.batches, surface.autoAccept);
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
  const skill = usableSkill(user, name);
  if (isUndefined(skill)) return errorCall(call, { error: 'unknownSkill' });
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
