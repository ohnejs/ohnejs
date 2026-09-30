import { deepStrictEqual, ok, strictEqual } from 'node:assert';
import { after, describe, it } from 'node:test';

import type { Turn } from '../../../src/ai/turns/state.ts';
import type { StreamedEvent } from '../api/ai/turns/_stand-in.ts';

import resultsPost from '../../../src/ai/api/ai/turns/[id]/results.post.ts';
import turnsPost from '../../../src/ai/api/ai/turns/index.post.ts';
import { useProvider } from '../../../src/ai/providers/use-provider.ts';
import { loadTurn } from '../../../src/ai/turns/state.ts';
import { followUpTranscript } from '../../../src/ai/turns/step.ts';
import { useCollections } from '../../../src/ohne/collections/use-collections.ts';
import { useEnv } from '../../../src/ohne/env/use-env.ts';
import { field } from '../../../src/ohne/fields/field.ts';
import { useFlows } from '../../../src/ohne/flows/use-flows.ts';
import { dispatch } from '../../../src/ohne/http/dispatch.ts';
import { parseSSE } from '../../../src/utils/sse/parse-sse.ts';
import { call, route, signIn, syncSchema, withAI } from '../_fixture.ts';
import { calls, readEvents, says } from '../api/ai/turns/_stand-in.ts';
import { sse, startProviderServer } from '../providers/_server.ts';

const TURNS = route('POST', '/ai/turns', turnsPost);
const RESULTS = route('POST', '/ai/turns/[id]/results', resultsPost);
const UUID = '019f3c1a-8b2d-7f4e-9a6b-1c2d3e4f5a6b';

useFlows().register('step-chain', {
  name: 'step-chain',
  flow: {
    description: 'Two nodes in a row.',
    start: 'first',
    nodes: { first: { act: { prompt: 'Count.' }, next: 'second' }, second: { act: {} } },
  },
});
useCollections().register('Places', {
  name: 'Places',
  collection: {
    api: { read: true },
    dashboard: { recordPath: '/media?details=[uuid]' },
    fields: { name: field('text') },
  },
});
useCollections().register('Settings', {
  name: 'Settings',
  collection: {
    singleton: true,
    api: { read: true },
    fields: { title: field('text', { default: 'Site' }) },
  },
});
await syncSchema();

const KEY = 'AI_STEP_TEST_KEY';
useEnv().define(KEY as never, { default: undefined as never });
useEnv().set(KEY as never, 'sk-test' as never);

const server = await startProviderServer();
const officer = await signIn('officer@step.example.com', ['officer']);
const reader = await signIn('reader@step.example.com', ['officer']);
const admin = await signIn('admin@step.example.com', ['admin']);

const partial = sse([
  {
    event: 'message_start',
    data: {
      type: 'message_start',
      message: {
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        model: 'claude-test',
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 25, output_tokens: 1 },
      },
    },
  },
  {
    event: 'content_block_start',
    data: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  },
  {
    event: 'content_block_delta',
    data: {
      type: 'content_block_delta',
      index: 0,
      delta: { type: 'text_delta', text: 'Thinking' },
    },
  },
]);

async function open(signal?: AbortSignal): Promise<{
  status: number;
  drain: () => Promise<void>;
  body: ReadableStream<Uint8Array> | null;
}> {
  const url = 'http://x.test/ai/turns';
  const headers = new Headers({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${officer.token}`,
  });
  const request = new Request(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ input: 'Who is that?', page: '/collections/characters' }),
    signal,
  });
  const { response, drain } = await dispatch(TURNS, request, new URL(url), {});
  return { status: response.status, drain, body: response.body };
}

/**
 * The app's `ai` settings, the model pointed at the stand-in.
 */
const AI = {
  model: 'smart',
  models: {
    smart: { provider: 'anthropic', model: 'claude-test', key: KEY, baseURL: server.url },
  },
} as const;

/**
 * Opens a turn with `body` on top of a plain question, reads its stream, and returns the turn's id.
 */
async function ask(body: Record<string, unknown> = {}): Promise<string> {
  const { response, drain } = await call(TURNS, {
    path: '/ai/turns',
    body: { input: 'Who is that?', page: '/collections/characters', ...body },
    token: reader.token,
  });
  const events = await readEvents(response);
  await drain();
  return events[0]?.data.id as string;
}

/**
 * Reports `results` for the turn `id`'s pending batch and reads the next step's stream.
 */
async function report(id: string, results: unknown[]): Promise<void> {
  const batch = (await loadTurn(id))?.batches.at(-1)?.id;
  const { response, drain } = await call(RESULTS, {
    path: `/ai/turns/${id}/results`,
    body: { batch, results },
    token: reader.token,
    params: { id },
  });
  await readEvents(response);
  await drain();
}

after(() => server.close());

describe('runStep', () => {
  it("keeps each step's text at `step - 1`, across a batch and the step that closes", async () => {
    await withAI(AI, async () => {
      server.answer(
        {
          body: calls('Reading.', [
            { id: 'toolu_1', name: 'describe', input: { collection: 'Items' } },
          ]),
        },
        { body: says('Nobody.') },
      );
      const id = await ask();
      deepStrictEqual((await loadTurn(id))?.texts, ['Reading.']);
      await report(id, []);
      deepStrictEqual((await loadTurn(id))?.texts, ['Reading.', 'Nobody.']);
    });
  });

  it('keeps `` for a step that streams no text, never a hole', async () => {
    await withAI(AI, async () => {
      server.answer(
        { body: calls('', [{ id: 'toolu_1', name: 'describe', input: { collection: 'Items' } }]) },
        { body: says('Nobody.') },
      );
      const id = await ask();
      await report(id, []);
      deepStrictEqual((await loadTurn(id))?.texts, ['', 'Nobody.']);
    });
  });

  it('keeps one text per node of a flow walked in one stream', async () => {
    await withAI(AI, async () => {
      server.answer({ body: says('Counted.') }, { body: says('Reported.') });
      const id = await ask({ flow: 'step-chain' });
      const turn = await loadTurn(id);
      strictEqual(turn?.step, 2);
      deepStrictEqual(turn?.texts, ['Counted.', 'Reported.']);
    });
  });

  it('keeps the text streamed before the provider failed', async () => {
    await withAI(AI, async () => {
      server.answer(...Array.from({ length: 3 }, () => ({ body: partial, cut: true })));
      const turn = await loadTurn(await ask());
      strictEqual(turn?.reason, 'provider');
      deepStrictEqual(turn?.texts, ['Thinking']);
    });
  });

  it('keeps only the text of the attempt a retry reran', async () => {
    await withAI(AI, async () => {
      server.answer({ body: partial, cut: true }, { body: says('Whole.') });
      deepStrictEqual((await loadTurn(await ask()))?.texts, ['Whole.']);
    });
  });

  it('keeps what the browser reported as counts and record ids, never a value', async () => {
    await withAI(AI, async () => {
      const read = { route: 'POST /collections/characters/query', body: { where: { UUID } } };
      server.answer(
        {
          body: calls('Reading.', [
            { id: 'toolu_1', name: 'request', input: { requests: [read] } },
          ]),
        },
        { body: says('Thrall.') },
      );
      const id = await ask();
      await report(id, [
        { status: 200, body: { records: [{ UUID, name: 'Thrall', level: 60 }], total: 1 } },
      ]);
      const reported = (await loadTurn(id))?.batches[0]?.reported;
      deepStrictEqual(reported, [{ status: 200, body: { total: 1, records: [{ UUID }] } }]);
      ok(!JSON.stringify(reported).includes('Thrall'));
    });
  });

  it('charges a step the client leaves before `done` its estimated input', async () => {
    await withAI(
      {
        model: 'smart',
        models: {
          smart: { provider: 'anthropic', model: 'claude-test', key: KEY, baseURL: server.url },
        },
        limits: { tokens: { limit: 30, window: '1h' } },
      },
      async () => {
        server.answer({ body: partial, hold: true });
        const controller = new AbortController();
        const opened = await open(controller.signal);
        strictEqual(opened.status, 200);
        let id = '';
        for await (const message of parseSSE(opened.body as ReadableStream<Uint8Array>)) {
          if (message.event === 'turn') id = (JSON.parse(message.data) as { id: string }).id;
          if (message.event === 'text') controller.abort();
        }
        await opened.drain();
        const left = await loadTurn(id);
        strictEqual(left?.reason, 'left');
        deepStrictEqual(left?.texts, ['Thinking']);
        const next = await open();
        strictEqual(next.status, 429);
        await next.drain();
      },
    );
  });
});

/**
 * Opens a turn as the admin whose first step makes the `open` calls `inputs`.
 * Returns the stream and the turn.
 */
async function openStep(
  ...inputs: Record<string, unknown>[]
): Promise<{ events: StreamedEvent[]; turn: Turn }> {
  server.answer({
    body: calls(
      'Opening.',
      inputs.map((input, index) => ({ id: `toolu_${index + 1}`, name: 'open', input })),
    ),
  });
  const { response, drain } = await call(TURNS, {
    path: '/ai/turns',
    body: { input: 'Open it', page: '/overview' },
    token: admin.token,
  });
  const events = await readEvents(response);
  await drain();
  return { events, turn: (await loadTurn(events[0]?.data.id as string)) as Turn };
}

/**
 * The page the batch event of `events` names.
 */
function openedPath(events: StreamedEvent[]): unknown {
  return events.find((event) => event.event === 'batch')?.data.open;
}

describe('the open tool', () => {
  it('files a listed page on the batch, which the browser answers with no proposals', async () => {
    await withAI(AI, async () => {
      const { events, turn } = await openStep({ page: '/overview' });
      const batch = turn.batches[0];
      deepStrictEqual(events.find((event) => event.event === 'batch')?.data, {
        id: batch?.id,
        kind: 'read',
        proposals: [],
        open: '/overview',
      });
      deepStrictEqual(batch?.open, { call: 0, path: '/overview' });
      deepStrictEqual(batch?.calls, [{ id: 'toolu_1', name: 'open' }]);
    });
  });

  it("opens a collection's list, and a record where its `recordPath` points", async () => {
    await withAI(AI, async () => {
      strictEqual(
        openedPath((await openStep({ collection: 'Places' })).events),
        '/collections/places',
      );
      strictEqual(
        openedPath((await openStep({ collection: 'Places', uuid: UUID })).events),
        `/media?details=${UUID}`,
      );
      strictEqual(
        openedPath((await openStep({ collection: 'Items', uuid: UUID })).events),
        `/collections/items/${UUID}`,
      );
    });
  });

  it("opens a singleton's editor, whatever `uuid` says", async () => {
    await withAI(AI, async () => {
      const { events } = await openStep({ collection: 'Settings', uuid: UUID });
      strictEqual(openedPath(events), '/collections/settings');
    });
  });

  it('refuses a bad shape, an unlisted page, a collection out of reach, a bad id, and a second open', async () => {
    await withAI(AI, async () => {
      const { events, turn } = await openStep(
        { uuid: UUID },
        { page: '/overview', collection: 'Items' },
        { page: '/logout' },
        { collection: 'Users' },
        { collection: 'Items', uuid: 'new' },
        { page: '/overview' },
        { page: '/account' },
      );
      strictEqual(openedPath(events), '/overview');
      deepStrictEqual(
        turn.batches[0]?.calls.map((entry) => entry.content ?? null),
        [
          '{"error":"invalidShape"}',
          '{"error":"invalidShape"}',
          '{"error":"unknownPage"}',
          '{"error":"unknownCollection"}',
          '{"error":"unknownRecord"}',
          null,
          '{"error":"oneOpen"}',
        ],
      );
    });
  });

  it('answers the call with what the browser reported, and keeps it on the batch', async () => {
    const answers = {
      opened: ['{"opened":"/overview"}', undefined],
      stayed: ['{"error":"stayed","page":"/overview"}', true],
      declined: ['{"error":"declined","page":"/overview"}', true],
    } as const;
    await withAI(AI, async () => {
      for (const [outcome, [content, error]] of Object.entries(answers)) {
        const { turn } = await openStep({ page: '/overview' });
        server.answer({ body: says('Opened.') });
        const { response, drain } = await call(RESULTS, {
          path: `/ai/turns/${turn.UUID}/results`,
          body: { batch: turn.batches[0]?.id, results: [], open: outcome },
          token: admin.token,
          params: { id: turn.UUID },
        });
        await readEvents(response);
        await drain();
        const batch = (await loadTurn(turn.UUID))?.batches[0];
        strictEqual(batch?.opened, outcome);
        deepStrictEqual(batch?.calls[0], {
          id: 'toolu_1',
          name: 'open',
          content,
          ...(error ? { error } : {}),
        });
      }
    });
  });

  it('closes an open the browser never answered, for a follow-up', async () => {
    await withAI(AI, async () => {
      const { turn } = await openStep({ page: '/overview' });
      const closed = JSON.stringify(followUpTranscript(turn, useProvider('smart')).at(-1));
      ok(closed.includes('toolu_1'));
      ok(closed.includes('turnClosed'));
    });
  });
});
