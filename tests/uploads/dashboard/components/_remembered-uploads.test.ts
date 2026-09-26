import { deepStrictEqual, doesNotReject, rejects, strictEqual } from 'node:assert';
import { describe, it } from 'node:test';

import {
  createRememberedUploads,
  matchesFile,
  type RememberedStorage,
  type RememberedUpload,
  type RememberedUploads,
  type RememberedUploadsOptions,
} from '../../../../src/uploads/dashboard/components/_remembered-uploads.ts';

interface Stub extends RememberedStorage {
  data: Map<string, string>;
}

const KEY = 'ohne-uploads-sessions';

const NOW = 1_700_000_000_000;

const DAY = 86_400_000;

const USER = 'warchief';

const SIGNAL = new AbortController().signal;

function storage(entries?: unknown): Stub {
  const data = new Map<string, string>();
  if (entries !== undefined) data.set(KEY, JSON.stringify(entries));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

function stored(stub: Stub): string[] {
  const raw = stub.data.get(KEY);
  return raw === undefined
    ? []
    : (JSON.parse(raw) as RememberedUpload[]).map(({ session }) => session);
}

function entry(session: string, changes: Partial<RememberedUpload> = {}): RememberedUpload {
  return {
    session,
    user: USER,
    directory: 'orgrimmar',
    name: `${session}.png`,
    size: 2048,
    lastModified: NOW - DAY,
    type: 'image/png',
    offset: 1024,
    chunkSize: 1024,
    expiresAt: NOW + DAY,
    ...changes,
  };
}

function fileOf(upload: RememberedUpload): File {
  return new File([new Uint8Array(upload.size)], upload.name, {
    type: upload.type,
    lastModified: upload.lastModified,
  });
}

const sessions = (entries: readonly RememberedUpload[]): string[] =>
  entries.map(({ session }) => session);

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve));

/**
 * Resolves once every lock request queued on `names` before the call has run.
 * Each lock serves its requests in order, so a hold queued last runs last.
 */
const flush = (remembered: RememberedUploads, ...names: string[]): Promise<unknown> =>
  Promise.all(names.map((session) => remembered.hold(session, SIGNAL, async () => undefined)));

/**
 * A store over `stub` for `USER` at `NOW`, as `changes` amend it.
 */
function store(
  stub: RememberedStorage,
  changes: Partial<RememberedUploadsOptions> = {},
): RememberedUploads {
  return createRememberedUploads({
    storage: () => stub,
    user: () => USER,
    now: () => NOW,
    ...changes,
  });
}

describe('createRememberedUploads', () => {
  it('lists the entries alive at creation as interrupted, and no entry remembered later', () => {
    const stub = storage([entry('thrall'), entry('jaina')]);
    const remembered = store(stub);

    remembered.remember(entry('arthas'));
    deepStrictEqual(sessions(remembered.interrupted()), ['thrall', 'jaina']);
    deepStrictEqual(stored(stub), ['thrall', 'jaina', 'arthas']);
  });

  it('stamps the signed-in user on every entry it remembers', () => {
    const stub = storage();
    const { user: _, ...thrall } = entry('thrall');
    store(stub).remember(thrall);

    deepStrictEqual(JSON.parse(stub.data.get(KEY) ?? ''), [{ ...thrall, user: USER }]);
  });

  it("lists and claims only the signed-in user's entries", () => {
    const arthas = entry('arthas', { user: 'lich-king' });
    let user = USER;
    const remembered = store(storage([entry('thrall'), arthas, entry('jaina')]), {
      user: () => user,
    });

    deepStrictEqual(sessions(remembered.interrupted()), ['thrall', 'jaina']);
    strictEqual(remembered.claim(fileOf(arthas), 'orgrimmar'), undefined);

    user = 'lich-king';
    deepStrictEqual(sessions(remembered.interrupted()), ['arthas']);
    deepStrictEqual(remembered.claim(fileOf(arthas), 'orgrimmar'), arthas);
  });

  it('drops expired entries on read, from storage too', () => {
    const stub = storage([entry('thrall', { expiresAt: NOW }), entry('jaina')]);
    let clock = NOW;
    const remembered = store(stub, { now: () => clock });

    deepStrictEqual(sessions(remembered.interrupted()), ['jaina']);
    deepStrictEqual(stored(stub), ['jaina']);

    clock = NOW + DAY;
    remembered.remember(entry('arthas', { expiresAt: NOW + 2 * DAY }));
    deepStrictEqual(stored(stub), ['arthas']);
  });

  it('stops listing and claiming an interrupted entry once it expires', () => {
    const thrall = entry('thrall');
    let clock = NOW;
    const remembered = store(storage([thrall]), { now: () => clock });

    deepStrictEqual(sessions(remembered.interrupted()), ['thrall']);
    clock = thrall.expiresAt;
    deepStrictEqual(remembered.interrupted(), []);
    strictEqual(remembered.claim(fileOf(thrall), 'orgrimmar'), undefined);
  });

  it('replaces the entry of the same session and keeps only the newest past the cap', () => {
    const stub = storage();
    const remembered = store(stub);
    for (let i = 0; i < 51; i++) remembered.remember(entry(`peon-${i}`));

    deepStrictEqual(stored(stub).length, 50);
    strictEqual(stored(stub)[0], 'peon-1');

    remembered.remember(entry('peon-1', { offset: 2048 }));
    strictEqual(stored(stub).at(-1), 'peon-1');
    strictEqual(stored(stub).length, 50);
    strictEqual((JSON.parse(stub.data.get(KEY) ?? '') as RememberedUpload[]).at(-1)?.offset, 2048);
  });

  it('forgets an entry in storage and in the interrupted list', () => {
    const stub = storage([entry('thrall'), entry('jaina')]);
    const remembered = store(stub);

    remembered.forget('thrall');
    deepStrictEqual(sessions(remembered.interrupted()), ['jaina']);
    deepStrictEqual(stored(stub), ['jaina']);

    remembered.forget('jaina');
    strictEqual(stub.data.has(KEY), false);
  });

  it('claims an interrupted upload by name, size, modification time, type, and folder', () => {
    const thrall = entry('thrall');
    const remembered = store(storage([thrall]));
    const misses: [Partial<RememberedUpload>, string][] = [
      [{ name: 'jaina.png' }, 'orgrimmar'],
      [{ size: 4096 }, 'orgrimmar'],
      [{ lastModified: NOW }, 'orgrimmar'],
      [{ type: 'image/webp' }, 'orgrimmar'],
      [{}, 'lordaeron'],
    ];
    for (const [changes, directory] of misses) {
      strictEqual(remembered.claim(fileOf({ ...thrall, ...changes }), directory), undefined);
    }
    deepStrictEqual(sessions(remembered.interrupted()), ['thrall']);

    deepStrictEqual(remembered.claim(fileOf(thrall), 'orgrimmar'), thrall);
    deepStrictEqual(remembered.interrupted(), []);
    strictEqual(remembered.claim(fileOf(thrall), 'orgrimmar'), undefined);
  });

  it('lists an entry once no tab holds its lock, if it is still stored by then', async () => {
    const stub = storage([entry('grom'), entry('rexxar'), entry('rokhan')]);
    const locked = { locks: navigator.locks };
    const sender = store(stub, locked);
    const release = Promise.withResolvers<void>();
    const holds = ['rexxar', 'rokhan'].map((session) =>
      sender.hold(session, SIGNAL, () => release.promise),
    );
    const tab = store(stub, locked);
    try {
      await flush(tab, 'grom');
      deepStrictEqual(sessions(tab.interrupted()), ['grom']);
      sender.forget('rokhan');
    } finally {
      release.resolve();
      await Promise.all(holds);
    }

    await flush(tab, 'rexxar', 'rokhan');
    deepStrictEqual(sessions(tab.interrupted()), ['grom', 'rexxar']);
  });

  it('holds a session for one send at a time, and an abort ends a wait with its reason', async () => {
    const remembered = store(storage(), { locks: navigator.locks });
    const release = Promise.withResolvers<void>();
    const first = remembered.hold('illidan', SIGNAL, () => release.promise);
    try {
      const controller = new AbortController();
      let sent = false;
      const waiting = remembered.hold('illidan', controller.signal, async () => {
        sent = true;
      });
      await tick();
      strictEqual(sent, false);

      controller.abort();
      await rejects(waiting, (error) => error === controller.signal.reason);
    } finally {
      release.resolve();
      await first;
    }
    strictEqual(await remembered.hold('illidan', SIGNAL, async () => 'sent'), 'sent');
  });

  it('discards a session only when no tab holds it, taking it off the list at once', async () => {
    const stub = storage([entry('tyrande'), entry('malfurion')]);
    const locked = { locks: navigator.locks };
    const remembered = store(stub, locked);
    await flush(remembered, 'tyrande', 'malfurion');
    const release = Promise.withResolvers<void>();
    const held = store(stub, locked).hold('tyrande', SIGNAL, () => release.promise);
    try {
      const discarding = remembered.discard('tyrande');
      deepStrictEqual(sessions(remembered.interrupted()), ['malfurion']);
      strictEqual(await discarding, false);
      deepStrictEqual(stored(stub), ['tyrande', 'malfurion']);
    } finally {
      release.resolve();
      await held;
    }

    strictEqual(await remembered.discard('malfurion'), true);
    deepStrictEqual(sessions(remembered.interrupted()), []);
    deepStrictEqual(stored(stub), ['tyrande']);
  });

  it('without locks, lists every entry at once, sends at once, and discards every session', async () => {
    const stub = storage([entry('thrall'), entry('jaina')]);
    const remembered = store(stub);
    let sent = false;
    const sending = remembered.hold('thrall', SIGNAL, async () => {
      sent = true;
    });

    deepStrictEqual(sessions(remembered.interrupted()), ['thrall', 'jaina']);
    strictEqual(sent, true);
    await sending;
    strictEqual(await remembered.discard('thrall'), true);
    deepStrictEqual(sessions(remembered.interrupted()), ['jaina']);
    deepStrictEqual(stored(stub), ['jaina']);
  });

  it('reads a malformed storage as empty and clears it', () => {
    for (const raw of [
      '{not json',
      '{"session":"thrall"}',
      JSON.stringify([{ session: 'thrall' }]),
      JSON.stringify([{ ...entry('thrall'), user: undefined }]),
    ]) {
      const stub = storage();
      stub.data.set(KEY, raw);
      const remembered = store(stub);

      deepStrictEqual(remembered.interrupted(), []);
      strictEqual(stub.data.has(KEY), false);
    }
  });

  it('never throws out of a storage that throws', async () => {
    const denied = (): never => {
      throw new DOMException('The operation is insecure.', 'SecurityError');
    };
    const stubs: (() => RememberedStorage)[] = [
      denied,
      () => ({ getItem: denied, setItem: denied, removeItem: denied }),
      () => ({ ...storage([entry('varian')]), setItem: denied, removeItem: denied }),
    ];
    for (const stub of stubs) {
      await doesNotReject(async () => {
        const remembered = createRememberedUploads({
          storage: stub,
          user: () => USER,
          locks: navigator.locks,
        });
        remembered.remember(entry('anduin'));
        remembered.forget('varian');
        remembered.claim(fileOf(entry('varian')), 'orgrimmar');
        remembered.interrupted();
        await remembered.hold('anduin', SIGNAL, async () => undefined);
        await remembered.discard('varian');
      });
    }
  });
});

describe('matchesFile', () => {
  it('tells the interrupted file from another one picked for its row', () => {
    const thrall = entry('thrall');

    strictEqual(matchesFile(thrall, fileOf(thrall)), true);
    strictEqual(matchesFile(thrall, fileOf({ ...thrall, name: 'jaina.png' })), false);
    strictEqual(matchesFile(thrall, fileOf({ ...thrall, size: 1 })), false);
    strictEqual(matchesFile(thrall, fileOf({ ...thrall, lastModified: NOW })), false);
    strictEqual(matchesFile(thrall, fileOf({ ...thrall, type: '' })), false);
  });
});
