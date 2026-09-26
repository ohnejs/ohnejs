import { deepStrictEqual, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import type {
  UploadSendHooks,
  UploadTask,
} from '../../../../src/uploads/dashboard/components/upload-queue-state.ts';
import type { UploadRecord, UploadSession } from '../../../../src/uploads/uploads/types.ts';

import {
  createRememberedUploads,
  type RememberedUpload,
  type RememberedUploads,
} from '../../../../src/uploads/dashboard/components/_remembered-uploads.ts';
import { createUploadQueue } from '../../../../src/uploads/dashboard/components/upload-queue-state.ts';
import {
  abandonAborted,
  abandonSession,
  discardSession,
  sendResumable,
  type SessionTransport,
} from '../../../../src/uploads/dashboard/components/upload-session.ts';
import { isUndefined } from '../../../../src/utils/index.ts';

type Fault = 'network' | 'lost' | number | null;

interface Server {
  transport: SessionTransport;
  sessions: Map<string, UploadSession>;
  bytes: Map<string, number[]>;
  calls: string[];
  sleeps: number[];
  faults: Fault[];
  seed(size: number, offset: number): string;
}

interface Log {
  progress: number[];
  sessions: (string | undefined)[];
  stalls: boolean[];
}

interface Memory {
  store: RememberedUploads;
  offsets: number[];
  stored(): string[];
  tab(): RememberedUploads;
}

const NOW = 1_700_000_000_000;

const DAY = 86_400_000;

const USER = 'warchief';

const SIGNAL = new AbortController().signal;

const MESSAGES: Record<number, string> = {
  404: 'The upload session has expired',
  408: 'Request timeout',
  413: 'Payload too large',
  422: 'File type `image/png` is not allowed',
  429: 'Too many requests',
  501: 'The `memory` storage cannot resume uploads',
  503: 'Service unavailable',
};

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function record(session: UploadSession): UploadRecord {
  return {
    UUID: `record-${session.UUID}`,
    kind: 'file',
    private: false,
    directory: session.directory,
    name: session.name,
    type: session.type,
    size: session.size,
    hash: null,
    width: null,
    height: null,
    description: null,
    focalX: null,
    focalY: null,
    author: null,
    uploadedAt: 0,
    _updatedAt: 0,
    path: session.name,
    url: `/uploads/${session.name}`,
  };
}

function bytes(size: number): Uint8Array<ArrayBuffer> {
  return Uint8Array.from({ length: size }, (_, i) => i % 251);
}

/**
 * An in-memory API answering the session routes, with scripted faults consumed one per request.
 */
function server(chunkSize: number): Server {
  const state: Server = {
    sessions: new Map(),
    bytes: new Map(),
    calls: [],
    sleeps: [],
    faults: [],
    transport: {
      api: (route, init) => handle(route, init?.body),
      apiUpload: (route, body, options) => {
        options.onProgress(body.size / 2, body.size);
        options.onProgress(body.size, body.size);
        return handle(route, body, options.headers);
      },
      sleep: (delay) => {
        state.sleeps.push(delay);
        return Promise.resolve();
      },
    },
    seed: (size, offset) => {
      const session: UploadSession = {
        UUID: `session-${state.sessions.size + 1}`,
        directory: 'orgrimmar',
        name: 'doomhammer.bin',
        type: 'application/octet-stream',
        size,
        chunkSize,
        offset,
        expiresAt: NOW + DAY,
        upload: null,
      };
      state.sessions.set(session.UUID, session);
      state.bytes.set(session.UUID, [...bytes(offset)]);
      return session.UUID;
    },
  };

  const answer = async (
    method: string,
    url: URL,
    body: unknown,
    headers: Record<string, string> = {},
  ): Promise<Response> => {
    const [, , , uuid = '', action] = url.pathname.split('/');
    if (method === 'POST' && uuid === '') {
      const { size } = JSON.parse(body as string) as { size: number };
      return json(201, state.sessions.get(state.seed(size, 0)));
    }
    const session = state.sessions.get(uuid);
    if (!session) return json(404, { statusCode: 404, message: MESSAGES[404] });
    const conflict = json(409, { statusCode: 409, message: 'Conflict', data: session });
    if (method === 'PATCH') {
      if (Number(headers['upload-offset']) !== session.offset) return conflict;
      const chunk = new Uint8Array(await (body as Blob).arrayBuffer());
      state.bytes.get(uuid)?.push(...chunk);
      session.offset += chunk.byteLength;
      return json(200, session);
    }
    if (action !== 'complete') return new Response(null, { status: 204 });
    if (session.offset < session.size) return conflict;
    const created = session.upload === null;
    session.upload = `record-${uuid}`;
    return json(created ? 201 : 200, record(session));
  };

  const handle = async (
    route: string,
    body: unknown,
    headers?: Record<string, string>,
  ): Promise<Response> => {
    const [method, path] = route.split(' ');
    const url = new URL(path, 'http://api.azeroth.example');
    const offset = headers?.['upload-offset'];
    const at = isUndefined(offset) ? '' : `@${offset}`;
    const size = body instanceof Blob ? ` ${body.size}` : '';
    state.calls.push(`${method} ${url.pathname}${url.search}${at}${size}`);
    const fault = state.faults.shift() ?? null;
    if (fault === 'network') throw new TypeError('Network request failed');
    if (typeof fault === 'number') {
      return json(fault, { statusCode: fault, message: MESSAGES[fault] });
    }
    const response = await answer(method, url, body, headers);
    if (fault === 'lost') throw new TypeError('Network request failed');
    return response;
  };

  return state;
}

/**
 * A remembered-uploads store over an in-memory storage, logging the offset of every write.
 * `tab` opens another store over the same storage, as another tab would; `stored` reads it at once.
 */
function memory(): Memory {
  const data = new Map<string, string>();
  const options = {
    storage: () => ({
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
    }),
    user: () => USER,
    now: () => NOW,
  };
  const tab = (): RememberedUploads =>
    createRememberedUploads({ ...options, locks: navigator.locks });
  const store = tab();
  const offsets: number[] = [];
  return {
    offsets,
    store: {
      ...store,
      remember: (entry) => {
        offsets.push(entry.offset);
        store.remember(entry);
      },
    },
    stored: () =>
      createRememberedUploads(options)
        .interrupted()
        .map((entry) => entry.session),
    tab,
  };
}

/**
 * An open session of `frostmourne.bin` for `remember`.
 */
function opened(session: string): Omit<RememberedUpload, 'user'> {
  return {
    session,
    directory: '',
    name: 'frostmourne.bin',
    size: 10,
    lastModified: 0,
    type: '',
    offset: 4,
    chunkSize: 4,
    expiresAt: NOW + DAY,
  };
}

function file(size: number): File {
  return new File([bytes(size)], 'doomhammer.bin', {
    type: 'application/octet-stream',
    lastModified: NOW - DAY,
  });
}

function task(source: File, session?: string): UploadTask {
  return {
    id: 'thrall',
    name: source.name,
    directory: 'orgrimmar',
    size: source.size,
    status: 'uploading',
    progress: 0,
    session,
    abort: () => undefined,
  };
}

function hooks(signal = new AbortController().signal): { log: Log; hooks: UploadSendHooks } {
  const log: Log = { progress: [], sessions: [], stalls: [] };
  return {
    log,
    hooks: {
      signal,
      onProgress: (loaded) => log.progress.push(loaded),
      onSession: (session) => log.sessions.push(session),
      onStall: (stalled) => log.stalls.push(stalled),
    },
  };
}

describe('sendResumable', () => {
  it('plans the chunks on the session grid at one URL, the last one short', async () => {
    const plans: [number, string[]][] = [
      [8, ['PATCH @0 4', 'PATCH @4 4']],
      [10, ['PATCH @0 4', 'PATCH @4 4', 'PATCH @8 2']],
      [5, ['PATCH @0 4', 'PATCH @4 1']],
    ];
    for (const [size, chunks] of plans) {
      const api = server(4);
      const source = file(size);
      const outcome = await sendResumable(
        task(source),
        source,
        hooks().hooks,
        api.transport,
        memory().store,
      );

      deepStrictEqual(
        api.calls.map((call) => call.replace('/uploads/sessions/session-1', '')),
        ['POST /uploads/sessions', ...chunks, 'POST /complete'],
      );
      deepStrictEqual(api.bytes.get('session-1'), [...bytes(size)]);
      deepStrictEqual(outcome, {
        ok: true,
        UUID: 'record-session-1',
        name: 'doomhammer.bin',
        directory: 'orgrimmar',
        size,
      });
    }
  });

  it('creates the session in the task folder and reports progress that never falls', async () => {
    const api = server(4);
    const source = file(10);
    api.faults.push(null, null, 'lost');
    const bodies: unknown[] = [];
    const transport: SessionTransport = {
      ...api.transport,
      api: (route, init) => {
        bodies.push(init?.body);
        return api.transport.api(route, init);
      },
    };
    const { log, hooks: sent } = hooks();
    await sendResumable(task(source), source, sent, transport, memory().store);

    deepStrictEqual(
      bodies[0],
      JSON.stringify({ directory: 'orgrimmar', name: source.name, size: 10 }),
    );
    deepStrictEqual(log.sessions, ['session-1']);
    deepStrictEqual(log.progress, [0, 2, 4, 4, 6, 8, 8, 8, 8, 9, 10, 10]);
  });

  it('remembers the session at create and after every chunk, and forgets it once complete', async () => {
    const api = server(4);
    const source = file(10);
    const remembered = memory();
    await sendResumable(task(source), source, hooks().hooks, api.transport, remembered.store);

    deepStrictEqual(remembered.offsets, [0, 4, 8, 10]);
    deepStrictEqual(remembered.stored(), []);
  });

  it('continues a known session from the offset its completion probe answers with a 409', async () => {
    const api = server(4);
    const source = file(10);
    const uuid = api.seed(10, 8);
    const { log, hooks: sent } = hooks();
    const outcome = await sendResumable(
      task(source, uuid),
      source,
      sent,
      api.transport,
      memory().store,
    );

    deepStrictEqual(api.calls, [
      'POST /uploads/sessions/session-1/complete',
      'PATCH /uploads/sessions/session-1@8 2',
      'POST /uploads/sessions/session-1/complete',
    ]);
    deepStrictEqual(log.sessions, []);
    deepStrictEqual(log.progress, [8, 9, 10, 10]);
    deepStrictEqual(api.bytes.get(uuid), [...bytes(10)]);
    strictEqual(outcome.ok, true);
  });

  it('resyncs to the offset a 409 carries without a wait', async () => {
    const api = server(4);
    const source = file(10);
    api.faults.push(null, 'lost');
    const outcome = await sendResumable(
      task(source),
      source,
      hooks().hooks,
      api.transport,
      memory().store,
    );

    deepStrictEqual(api.calls.slice(1, 4), [
      'PATCH /uploads/sessions/session-1@0 4',
      'PATCH /uploads/sessions/session-1@0 4',
      'PATCH /uploads/sessions/session-1@4 4',
    ]);
    deepStrictEqual(api.sleeps, [1000]);
    deepStrictEqual(api.bytes.get('session-1'), [...bytes(10)]);
    strictEqual(outcome.ok, true);
  });

  it('backs off 1s, 2s, 4s, and 8s, stalled while waiting, and starts over after a chunk', async () => {
    const api = server(4);
    const source = file(10);
    api.faults.push(null, 'network', 503, 429, 408, null, 'network');
    const { log, hooks: sent } = hooks();
    const outcome = await sendResumable(task(source), source, sent, api.transport, memory().store);

    deepStrictEqual(api.sleeps, [1000, 2000, 4000, 8000, 1000]);
    deepStrictEqual(log.stalls, [true, false, true, false, true, false, true, false, true, false]);
    strictEqual(outcome.ok, true);
  });

  it('fails the task once the fifth retry fails, and keeps the session', async () => {
    const api = server(4);
    const source = file(10);
    api.faults.push(null, ...Array<Fault>(6).fill('network'));
    const remembered = memory();
    const { log, hooks: sent } = hooks();

    await rejects(
      sendResumable(task(source), source, sent, api.transport, remembered.store),
      TypeError,
    );
    deepStrictEqual(api.sleeps, [1000, 2000, 4000, 8000, 16000]);
    strictEqual(api.calls.filter((call) => call.startsWith('PATCH')).length, 6);
    deepStrictEqual(log.sessions, ['session-1']);
    deepStrictEqual(remembered.stored(), ['session-1']);
  });

  it('answers the last transient status once the retries run out, and keeps the session', async () => {
    const api = server(4);
    const source = file(10);
    api.faults.push(null, ...Array<Fault>(6).fill(503));
    const remembered = memory();
    const { log, hooks: sent } = hooks();
    const outcome = await sendResumable(
      task(source),
      source,
      sent,
      api.transport,
      remembered.store,
    );

    deepStrictEqual(outcome, { ok: false, error: MESSAGES[503] });
    deepStrictEqual(log.sessions, ['session-1']);
    deepStrictEqual(remembered.stored(), ['session-1']);
  });

  it("drops and forgets the session the server discarded on a 404 or a chunk's 422", async () => {
    for (const status of [404, 422]) {
      const api = server(4);
      const source = file(10);
      api.faults.push(null, status);
      const remembered = memory();
      const { log, hooks: sent } = hooks();
      const outcome = await sendResumable(
        task(source),
        source,
        sent,
        api.transport,
        remembered.store,
      );

      deepStrictEqual(outcome, { ok: false, error: MESSAGES[status] });
      deepStrictEqual(log.sessions, ['session-1', undefined]);
      deepStrictEqual(remembered.stored(), []);
      deepStrictEqual(api.sleeps, []);
      strictEqual(api.calls.at(-1), 'PATCH /uploads/sessions/session-1@0 4');
    }
  });

  it("abandons the session on a chunk's 413, refused before the server's handler", async () => {
    const api = server(4);
    const source = file(10);
    api.faults.push(null, 413);
    const remembered = memory();
    const { log, hooks: sent } = hooks();
    const outcome = await sendResumable(
      task(source),
      source,
      sent,
      api.transport,
      remembered.store,
    );

    deepStrictEqual(outcome, { ok: false, error: MESSAGES[413] });
    deepStrictEqual(log.sessions, ['session-1', undefined]);
    deepStrictEqual(remembered.stored(), []);
    strictEqual(api.calls.at(-1), 'DELETE /uploads/sessions/session-1');
  });

  it('opens a fresh session for the file when the probe finds its known one gone', async () => {
    const api = server(4);
    const source = file(10);
    const remembered = memory();
    remembered.store.remember(opened('session-6'));
    const { log, hooks: sent } = hooks();
    const outcome = await sendResumable(
      task(source, 'session-6'),
      source,
      sent,
      api.transport,
      remembered.store,
    );

    deepStrictEqual(api.calls.slice(0, 3), [
      'POST /uploads/sessions/session-6/complete',
      'POST /uploads/sessions',
      'PATCH /uploads/sessions/session-1@0 4',
    ]);
    deepStrictEqual(log.sessions, [undefined, 'session-1']);
    deepStrictEqual(api.bytes.get('session-1'), [...bytes(10)]);
    deepStrictEqual(remembered.stored(), []);
    strictEqual(outcome.ok, true);
  });

  it('forgets the session on any other final error, and the task keeps it for a retry', async () => {
    const api = server(4);
    const source = file(10);
    api.faults.push(null, null, null, null, 422);
    const remembered = memory();
    const { log, hooks: sent } = hooks();
    const outcome = await sendResumable(
      task(source),
      source,
      sent,
      api.transport,
      remembered.store,
    );

    deepStrictEqual(outcome, { ok: false, error: MESSAGES[422] });
    strictEqual(api.calls.at(-1), 'POST /uploads/sessions/session-1/complete');
    deepStrictEqual(log.sessions, ['session-1']);
    deepStrictEqual(remembered.stored(), []);
  });

  it('answers a refused create with its wire message, and never retries a 501', async () => {
    for (const status of [422, 501]) {
      const api = server(4);
      const source = file(10);
      api.faults.push(status);
      const remembered = memory();
      const { log, hooks: sent } = hooks();
      const outcome = await sendResumable(
        task(source),
        source,
        sent,
        api.transport,
        remembered.store,
      );

      deepStrictEqual(outcome, { ok: false, error: MESSAGES[status] });
      deepStrictEqual(api.sleeps, []);
      deepStrictEqual(log.sessions, []);
      deepStrictEqual(remembered.offsets, []);
    }
  });

  it('rejects with the abort reason at once when aborted during a wait', async () => {
    const api = server(4);
    const source = file(10);
    api.faults.push(null, 'network');
    let asleep!: () => void;
    const waiting = new Promise<void>((resolve) => (asleep = resolve));
    const transport: SessionTransport = {
      ...api.transport,
      sleep: (_delay, { signal }) => {
        asleep();
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      },
    };
    const controller = new AbortController();
    const { log, hooks: sent } = hooks(controller.signal);
    const sending = sendResumable(task(source), source, sent, transport, memory().store);

    await waiting;
    controller.abort();
    await rejects(sending, { name: 'AbortError' });
    deepStrictEqual(log.stalls, [true]);
  });

  it('abandons a session its create answers after an abort, and never reports it', async () => {
    const api = server(4);
    const source = file(10);
    const answered = Promise.withResolvers<void>();
    const inits: (RequestInit | undefined)[] = [];
    const transport: SessionTransport = {
      ...api.transport,
      api: async (route, init) => {
        if (route === 'POST /uploads/sessions') {
          inits.push(init);
          await answered.promise;
        }
        return api.transport.api(route, init);
      },
    };
    const controller = new AbortController();
    const remembered = memory();
    const { log, hooks: sent } = hooks(controller.signal);
    const sending = sendResumable(task(source), source, sent, transport, remembered.store);

    controller.abort();
    answered.resolve();
    await rejects(sending, (error) => error === controller.signal.reason);
    strictEqual(inits[0]?.signal, undefined);
    strictEqual(api.calls.at(-1), 'DELETE /uploads/sessions/session-1');
    deepStrictEqual(log.sessions, []);
    deepStrictEqual(remembered.offsets, []);
  });

  it('sends under the session lock, so another tab lists the session only once the send fails', async () => {
    const api = server(4);
    const source = file(10);
    const entered = Promise.withResolvers<void>();
    const gate = Promise.withResolvers<void>();
    const transport: SessionTransport = {
      ...api.transport,
      apiUpload: async (route, body, options) => {
        entered.resolve();
        await gate.promise;
        return api.transport.apiUpload(route, body, options);
      },
    };
    const remembered = memory();
    const sending = sendResumable(task(source), source, hooks().hooks, transport, remembered.store);
    await entered.promise;
    const tab = remembered.tab();
    try {
      await new Promise((resolve) => setTimeout(resolve));
      deepStrictEqual(tab.interrupted(), []);
      api.faults.push(...Array<Fault>(6).fill('network'));
    } finally {
      gate.resolve();
    }

    await rejects(sending, TypeError);
    await tab.hold('session-1', SIGNAL, async () => undefined);
    deepStrictEqual(
      tab.interrupted().map((entry) => entry.session),
      ['session-1'],
    );
  });
});

describe('abandonSession', () => {
  it('sends the DELETE with keepalive, unawaited, and forgets the session', () => {
    const remembered = memory();
    remembered.store.remember(opened('session-7'));
    const requests: [string, RequestInit | undefined][] = [];
    const api = (route: string, init?: RequestInit): Promise<Response> => {
      requests.push([route, init]);
      return new Promise(() => undefined);
    };
    abandonSession('session-7', { api }, remembered.store);

    deepStrictEqual(requests, [['DELETE /uploads/sessions/session-7', { keepalive: true }]]);
    deepStrictEqual(remembered.stored(), []);
  });
});

describe('abandonAborted', () => {
  it('sends the DELETE for a task aborted running or pending, never for a failed one', async () => {
    const api = server(4);
    const failing = api.seed(10, 4);
    const pending = api.seed(10, 4);
    api.faults.push(422);
    const deletes: string[] = [];
    let sending!: () => void;
    const sent = new Promise<void>((resolve) => (sending = resolve));
    const transport: SessionTransport = {
      ...api.transport,
      api: (route, init) => {
        if (route.startsWith('DELETE')) deletes.push(route);
        return api.transport.api(route, init);
      },
      apiUpload: (_route, _body, { signal }) => {
        sending();
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      },
    };
    const remembered = memory();
    const queue = createUploadQueue(
      (task, item, hooks) =>
        sendResumable(task, (item as { file: File }).file, hooks, transport, remembered.store),
      { concurrency: 1, onSettle: (task) => abandonAborted(task, transport, remembered.store) },
    );
    const batch = queue.enqueue([
      { file: file(10), directory: 'orgrimmar', session: failing },
      { file: file(10), directory: 'orgrimmar' },
      { file: file(10), directory: 'orgrimmar', session: pending },
    ]);

    await sent;
    const [, running, waiting] = queue.tasks();
    waiting.abort();
    running.abort();
    await batch;

    deepStrictEqual(
      queue.tasks().map((task) => [task.status, task.session]),
      [
        ['failed', failing],
        ['aborted', 'session-3'],
        ['aborted', pending],
      ],
    );
    deepStrictEqual(deletes, [
      `DELETE /uploads/sessions/${pending}`,
      'DELETE /uploads/sessions/session-3',
    ]);
    deepStrictEqual(remembered.stored(), []);
  });

  it('sends no DELETE for a cleared task, and lists its session as interrupted once it stops', async () => {
    const api = server(4);
    const deletes: string[] = [];
    const sent = Promise.withResolvers<void>();
    const transport: SessionTransport = {
      ...api.transport,
      api: (route, init) => {
        if (route.startsWith('DELETE')) deletes.push(route);
        return api.transport.api(route, init);
      },
      apiUpload: (_route, _body, { signal }) => {
        sent.resolve();
        return new Promise((_, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        });
      },
    };
    const remembered = memory();
    const queue = createUploadQueue(
      (task, item, hooks) =>
        sendResumable(task, (item as { file: File }).file, hooks, transport, remembered.store),
      { onSettle: (task) => abandonAborted(task, transport, remembered.store) },
    );
    const batch = queue.enqueue([{ file: file(10), directory: 'orgrimmar' }]);

    await sent.promise;
    queue.clear();
    await batch;
    await remembered.store.hold('session-1', SIGNAL, async () => undefined);

    deepStrictEqual(deletes, []);
    deepStrictEqual(remembered.stored(), ['session-1']);
    deepStrictEqual(
      remembered.store.interrupted().map((entry) => entry.session),
      ['session-1'],
    );
  });
});

describe('discardSession', () => {
  it('forgets a session and sends the DELETE, unless another tab is sending it', async () => {
    const remembered = memory();
    remembered.store.remember(opened('session-8'));
    const requests: [string, RequestInit | undefined][] = [];
    const api = (route: string, init?: RequestInit): Promise<Response> => {
      requests.push([route, init]);
      return new Promise(() => undefined);
    };
    const release = Promise.withResolvers<void>();
    const held = remembered.tab().hold('session-8', SIGNAL, () => release.promise);
    try {
      await discardSession('session-8', { api }, remembered.store);
      deepStrictEqual(requests, []);
      deepStrictEqual(remembered.stored(), ['session-8']);
    } finally {
      release.resolve();
      await held;
    }

    await discardSession('session-8', { api }, remembered.store);
    deepStrictEqual(requests, [['DELETE /uploads/sessions/session-8', { keepalive: true }]]);
    deepStrictEqual(remembered.stored(), []);
  });
});
